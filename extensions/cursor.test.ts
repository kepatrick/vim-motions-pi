import { describe, expect, it, vi } from "vitest";
import { CURSOR_MARKER, visibleWidth } from "@mariozechner/pi-tui";
import { HardwareCursor, stripFakeCursor } from "./cursor";

function createTUI(visible = false) {
	return {
		getShowHardwareCursor: vi.fn(() => visible),
		setShowHardwareCursor: vi.fn((value: boolean) => { visible = value; }),
		terminal: { write: vi.fn() },
	};
}

describe("real terminal cursor", () => {
	it.each([["bar", "\x1b[6 q"], ["block", "\x1b[2 q"], ["underline", "\x1b[4 q"]] as const)("sets %s using DECSCUSR", (style, escape) => {
		const tui = createTUI();
		const cursor = new HardwareCursor(tui);
		expect(cursor.apply(style, true)).toBe(true);
		expect(tui.setShowHardwareCursor).toHaveBeenCalledWith(true);
		expect(tui.terminal.write).toHaveBeenCalledWith(escape);
		cursor.apply(style, true);
		expect(tui.terminal.write).toHaveBeenCalledTimes(1);
		cursor.restore();
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[0 q");
		expect(tui.setShowHardwareCursor).toHaveBeenLastCalledWith(false);
		cursor.restore();
		expect(tui.terminal.write).toHaveBeenCalledTimes(2);
	});

	it("restores previously enabled hardware cursors on focus loss", () => {
		const tui = createTUI(true);
		const cursor = new HardwareCursor(tui);
		cursor.apply("bar", true);
		expect(cursor.apply("bar", false)).toBe(false);
		expect(tui.setShowHardwareCursor).toHaveBeenLastCalledWith(true);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[0 q");
		cursor.apply("bar", true);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[6 q");
	});

	it("falls back safely when the host cannot control hardware cursors", () => {
		const cursor = new HardwareCursor({ terminal: { write: vi.fn() } });
		expect(cursor.apply("bar", true)).toBe(false);
		cursor.restore();
	});
});

describe("removing fake cursors without changing text", () => {
	it.each([" ", "b", "中", "😀", "e\u0301"])("preserves %j in all supported wire formats", (grapheme) => {
		for (const decoration of [
			`\x1b_pi:fc\x07${grapheme}\x1b_pi:/fc\x07`,
			`\x1b[7m${grapheme}\x1b[0m`,
			`\x1b[7m${grapheme}\x1b[27m`,
		]) {
			const line = `a${CURSOR_MARKER}${decoration}c`;
			const expected = `a${CURSOR_MARKER}${grapheme}c`;
			expect(stripFakeCursor(line, CURSOR_MARKER)).toBe(expected);
			expect(visibleWidth(stripFakeCursor(line, CURSOR_MARKER))).toBe(visibleWidth(expected));
		}
	});

	it("leaves unrelated highlighting and unmarked cursors alone", () => {
		for (const line of ["plain", "\x1b[7mselected\x1b[0m", `\x1b[7msuggestion\x1b[0m${CURSOR_MARKER}plain`]) {
			expect(stripFakeCursor(line, CURSOR_MARKER)).toBe(line);
		}
	});
});
