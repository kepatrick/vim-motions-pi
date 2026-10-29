import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { validSequence, type CursorStyle, type VimSettings } from "./settings";

type SettingsUI = Pick<ExtensionContext["ui"], "select" | "input" | "notify">;

export async function showVimSettings(
	ui: SettingsUI,
	current: () => VimSettings,
	update: (patch: Partial<VimSettings>) => void,
	path: string,
): Promise<void> {
	while (true) {
		const s = current();
		const rows = [
			`Escape sequence: ${s.escapeSequence || "disabled"}`,
			`Escape timeout: ${s.escapeTimeoutMs} ms`,
			`Insert cursor: ${s.insertCursor}`,
			`Normal cursor: ${s.normalCursor}`,
			`Visual cursor: ${s.visualCursor}`,
			`Visual-line cursor: ${s.visualLineCursor}`,
			`Clipboard sync: ${s.clipboard}`,
			`Clipboard command: ${s.clipboardCommand || "auto-detect"}`,
			"Done",
		];
		const choice = await ui.select("Vim settings", rows);
		const index = choice === undefined ? -1 : rows.indexOf(choice);
		if (index < 0 || index === 8) return;
		let patch: Partial<VimSettings> | undefined;
		if (index === 0) {
			const value = await ui.input("Escape sequence (2–32 printable ASCII characters; empty disables)", s.escapeSequence);
			if (value === undefined) continue;
			if (!validSequence(value)) { ui.notify("Use 2–32 printable ASCII characters, or empty to disable", "warning"); continue; }
			patch = { escapeSequence: value };
		} else if (index === 1) {
			const value = await ui.input("Escape timeout in milliseconds (1–60000)", String(s.escapeTimeoutMs));
			if (value === undefined) continue;
			const n = Number(value);
			if (!Number.isInteger(n) || n < 1 || n > 60000) { ui.notify("Enter an integer from 1 to 60000", "warning"); continue; }
			patch = { escapeTimeoutMs: n };
		} else if (index >= 2 && index <= 5) {
			const options = ["block", "bar", "underline"];
			const value = await ui.select("Terminal cursor shape", options);
			if (!value || !options.includes(value)) continue;
			const key = (["insertCursor", "normalCursor", "visualCursor", "visualLineCursor"] as const)[index - 2]!;
			patch = { [key]: value as CursorStyle };
		} else if (index === 6) {
			const options = ["Off", "Yank only", "All operations"];
			const value = await ui.select("Clipboard sync", options);
			if (!value || !options.includes(value)) continue;
			patch = { clipboard: value === "Off" ? "off" : value === "Yank only" ? "yank" : "all" };
		} else if (index === 7) {
			const value = await ui.input("Clipboard command (empty = auto-detect; no shell expansion)", s.clipboardCommand);
			if (value === undefined) continue;
			if (/[\x00-\x1f\x7f]/.test(value)) { ui.notify("Enter a single-line command", "warning"); continue; }
			patch = { clipboardCommand: value.trim() };
		}
		if (patch) {
			try { update(patch); ui.notify(`Vim settings saved to ${path}`, "info"); }
			catch (error) { ui.notify(`Could not save Vim settings: ${error}`, "error"); }
		}
	}
}
