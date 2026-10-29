import type { CursorStyle } from "./settings";

export interface CursorTUI {
	getShowHardwareCursor?: () => boolean;
	setShowHardwareCursor?: (enabled: boolean) => void;
	terminal?: { write?: (data: string) => void };
}

const SHAPES: Record<CursorStyle, string> = {
	block: "\x1b[2 q",
	underline: "\x1b[4 q",
	bar: "\x1b[6 q",
};

// DECSCUSR controls the real terminal cursor; no characters are substituted.
export class HardwareCursor {
	private previousVisibility: boolean | undefined;
	private style: CursorStyle | undefined;
	constructor(private tui: CursorTUI) {}

	apply(style: CursorStyle, focused: boolean): boolean {
		if (!focused) { this.restore(); return false; }
		if (!this.tui.getShowHardwareCursor || !this.tui.setShowHardwareCursor || !this.tui.terminal?.write) return false;
		if (this.previousVisibility === undefined) {
			this.previousVisibility = this.tui.getShowHardwareCursor();
			this.tui.setShowHardwareCursor(true);
		}
		if (this.style !== style) {
			this.tui.terminal.write(SHAPES[style]);
			this.style = style;
		}
		return true;
	}

	restore(): void {
		if (this.previousVisibility === undefined) return;
		this.tui.terminal?.write?.("\x1b[0 q"); // Restore terminal-default shape.
		this.tui.setShowHardwareCursor?.(this.previousVisibility);
		this.previousVisibility = undefined;
		this.style = undefined;
	}
}

// Keep the positioning marker and the complete grapheme; remove only the fake
// cursor decoration. Supports Pi's APC markers and the legacy reverse-video form.
export function stripFakeCursor(line: string, marker: string): string {
	const index = line.indexOf(marker);
	if (index === -1) return line;
	const start = index + marker.length;
	const after = line.slice(start);
	const match = after.match(/^\x1b_pi:fc\x07([\s\S]*?)\x1b_pi:\/fc\x07/)
		?? after.match(/^\x1b\[7m([\s\S]*?)\x1b\[(?:0|27)m/);
	if (!match) return line;
	return line.slice(0, start) + match[1] + after.slice(match[0].length);
}
