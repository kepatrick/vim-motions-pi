import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings, readSettings, saveSettings, validateSettings } from "./settings";
import { showVimSettings } from "./settings-ui";

describe("Vim settings", () => {
	let directory: string;
	let path: string;
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "vim-settings-"));
		path = join(directory, "config.json");
	});
	afterEach(() => { rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

	it("uses environment variables as defaults", () => {
		vi.stubEnv("VIM_MOTION_PI_ESCAPE_SEQUENCE", "jj");
		vi.stubEnv("VIM_MOTION_PI_ESCAPE_TIMEOUT_MS", "300");
		vi.stubEnv("VIM_MOTION_PI_CLIPBOARD", "yank");
		expect(defaultSettings()).toMatchObject({ escapeSequence: "jj", escapeTimeoutMs: 300, clipboard: "yank" });
		expect(readSettings(path)).toEqual({});
	});

	it("persists explicit overrides and preserves other settings", () => {
		saveSettings({ escapeSequence: "jj", insertCursor: "underline" }, path);
		saveSettings({ clipboard: "all", escapeSequence: "" }, path);
		expect(readSettings(path)).toEqual({ escapeSequence: "", insertCursor: "underline", clipboard: "all" });
		expect(readdirSync(directory)).toEqual(["config.json"]);
	});

	it.each([
		{ escapeSequence: "j" }, { escapeSequence: "😀😀" }, { escapeSequence: "j\n" },
		{ escapeTimeoutMs: 0 }, { escapeTimeoutMs: 1.5 }, { escapeTimeoutMs: 60001 },
		{ clipboard: "invalid" }, { normalCursor: "invalid" }, [], null,
	])("rejects invalid configuration %j", (value) => {
		expect(() => validateSettings(value)).toThrow();
	});

	it("does not overwrite malformed configuration", () => {
		writeFileSync(path, "invalid json");
		expect(() => saveSettings({ clipboard: "off" }, path)).toThrow();
		expect(readFileSync(path, "utf8")).toBe("invalid json");
	});

	it.each([2, 3, 4, 5])("saves the cursor selection for menu row %i", async (row) => {
		const ui = {
			select: vi.fn().mockImplementationOnce((_title, rows) => rows[row]).mockResolvedValueOnce("underline").mockResolvedValueOnce(undefined),
			input: vi.fn(), notify: vi.fn(),
		};
		const update = vi.fn();
		await showVimSettings(ui, defaultSettings, update, path);
		expect(update).toHaveBeenCalledWith({ [["insertCursor", "normalCursor", "visualCursor", "visualLineCursor"][row - 2]!]: "underline" });
	});

	it("does not save on cancellation or invalid input", async () => {
		const ui = {
			select: vi.fn().mockImplementationOnce((_t, rows) => rows[0]).mockImplementationOnce((_t, rows) => rows[1]).mockResolvedValueOnce(undefined),
			input: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce("0"), notify: vi.fn(),
		};
		const update = vi.fn();
		await showVimSettings(ui, defaultSettings, update, path);
		expect(update).not.toHaveBeenCalled();
		expect(ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
	});

	it("reports save failures instead of claiming success", async () => {
		const ui = { select: vi.fn().mockImplementationOnce((_t, rows) => rows[0]).mockResolvedValueOnce(undefined), input: vi.fn().mockResolvedValue("jk"), notify: vi.fn() };
		await showVimSettings(ui, defaultSettings, () => { throw new Error("disk full"); }, path);
		expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("disk full"), "error");
	});
});
