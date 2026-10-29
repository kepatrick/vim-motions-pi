import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ClipboardMode } from "./core";

export type CursorStyle = "block" | "bar" | "underline";
export type VimSettings = {
	escapeSequence: string;
	escapeTimeoutMs: number;
	clipboard: ClipboardMode;
	clipboardCommand: string;
	insertCursor: CursorStyle;
	normalCursor: CursorStyle;
	visualCursor: CursorStyle;
	visualLineCursor: CursorStyle;
};

export function settingsPath(): string {
	return join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "vim-motions.json");
}

export function validSequence(value: unknown): value is string {
	return typeof value === "string" && (value === "" || /^[\x20-\x7e]{2,32}$/.test(value));
}

export function validateSettings(value: unknown): Partial<VimSettings> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Settings must be a JSON object");
	const result: Partial<VimSettings> = {};
	for (const [key, v] of Object.entries(value)) {
		if (key === "escapeSequence") {
			if (!validSequence(v)) throw new Error("Escape sequence must be empty or 2–32 printable ASCII characters");
			result.escapeSequence = v;
		} else if (key === "escapeTimeoutMs") {
			if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 60000) throw new Error("Timeout must be an integer from 1 to 60000 ms");
			result.escapeTimeoutMs = v;
		} else if (key === "clipboardCommand") {
			if (typeof v !== "string" || /[\x00-\x1f\x7f]/.test(v)) throw new Error("Clipboard command must be a single line");
			result.clipboardCommand = v.trim();
		} else if (key === "clipboard") {
			if (v !== "off" && v !== "all" && v !== "yank") throw new Error("Invalid clipboard mode");
			result.clipboard = v;
		} else if (["insertCursor", "normalCursor", "visualCursor", "visualLineCursor"].includes(key)) {
			if (v !== "block" && v !== "bar" && v !== "underline") throw new Error("Invalid cursor style");
			result[key as "insertCursor"] = v;
		}
	}
	return result;
}

export function defaultSettings(): VimSettings {
	const seq = process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE?.trim() ?? "";
	const timeout = Number(process.env.VIM_MOTION_PI_ESCAPE_TIMEOUT_MS);
	const clipboard = process.env.VIM_MOTION_PI_CLIPBOARD;
	return {
		escapeSequence: validSequence(seq) ? seq : "",
		escapeTimeoutMs: Number.isInteger(timeout) && timeout > 0 && timeout <= 60000 ? timeout : 100,
		clipboard: clipboard === "all" || clipboard === "yank" ? clipboard : "off",
		clipboardCommand: process.env.VIM_MOTION_PI_CLIPBOARD_COMMAND?.trim() ?? "",
		insertCursor: "bar", normalCursor: "block", visualCursor: "underline", visualLineCursor: "underline",
	};
}

export function readSettings(path = settingsPath()): Partial<VimSettings> {
	try {
		return validateSettings(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

// Save only explicit overrides: environment variables remain defaults for unset keys.
export function saveSettings(patch: Partial<VimSettings>, path = settingsPath()): void {
	const next = { ...readSettings(path), ...validateSettings(patch) };
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
