import {
	clamp,
	expandParagraphObject,
	expandWordObject,
	firstNonBlankIndex,
	indexToCursor,
	lineBounds,
	lineEndCharIndex,
	lineStartIndex,
	nextWordStart,
	prevWordStart,
	splitLines,
	textToIndex,
	wordEnd,
	type Range,
} from "./core";

export type BufferMotion = "w" | "b" | "e" | "0" | "^" | "$";
export type TextObjectPrefix = "i" | "a";
export type TextObjectKind = "w" | "W" | "p";
export type Register = {
	text: string;
	linewise: boolean;
};

export class VimBuffer {
	text: string;
	cursorIndex: number;
	register: Register;

	constructor(text: string, cursorIndex = 0, register: Register = { text: "", linewise: false }) {
		this.text = text;
		this.cursorIndex = clamp(cursorIndex, 0, text.length);
		this.register = { ...register };
	}

	private replaceText(nextText: string, cursorIndex: number): void {
		this.text = nextText;
		this.cursorIndex = clamp(cursorIndex, 0, this.text.length);
	}

	insertAt(index: number, insertText: string): void {
		const safe = clamp(index, 0, this.text.length);
		this.replaceText(this.text.slice(0, safe) + insertText + this.text.slice(safe), safe + insertText.length);
	}

	private deleteRange(start: number, end: number): string {
		const a = clamp(Math.min(start, end), 0, this.text.length);
		const b = clamp(Math.max(start, end), 0, this.text.length);
		const deleted = this.text.slice(a, b);
		this.replaceText(this.text.slice(0, a) + this.text.slice(b), a);
		return deleted;
	}

	deleteLine(count = 1): string {
		const cursor = indexToCursor(this.text, this.cursorIndex);
		const lines = splitLines(this.text);
		const startLine = clamp(cursor.line, 0, Math.max(0, lines.length - 1));
		const endLine = clamp(startLine + Math.max(1, count), 0, lines.length);
		const deleted = lines.slice(startLine, endLine).join("\n") + (endLine < lines.length ? "\n" : "");
		this.register = { text: deleted, linewise: true };
		lines.splice(startLine, endLine - startLine);
		if (lines.length === 0) lines.push("");
		const next = lines.join("\n");
		this.replaceText(next, textToIndex(next, { line: clamp(startLine, 0, lines.length - 1), col: 0 }));
		return deleted;
	}

	yankLine(count = 1): string {
		const cursor = indexToCursor(this.text, this.cursorIndex);
		const lines = splitLines(this.text);
		const startLine = clamp(cursor.line, 0, Math.max(0, lines.length - 1));
		const endLine = clamp(startLine + Math.max(1, count), 0, lines.length);
		const yanked = lines.slice(startLine, endLine).join("\n") + (endLine < lines.length ? "\n" : "");
		this.register = { text: yanked, linewise: true };
		return yanked;
	}

	deleteCurrentChar(count: number): string {
		const deleted = this.text.slice(this.cursorIndex, Math.min(this.text.length, this.cursorIndex + count));
		this.register = { text: deleted, linewise: false };
		this.deleteRange(this.cursorIndex, this.cursorIndex + count);
		return deleted;
	}

	deleteBackwardChar(count: number): string {
		const start = Math.max(0, this.cursorIndex - count);
		const deleted = this.text.slice(start, this.cursorIndex);
		this.register = { text: deleted, linewise: false };
		this.deleteRange(start, this.cursorIndex);
		return deleted;
	}

	motionRange(motion: BufferMotion, count: number): { start: number; end: number } | null {
		let start = this.cursorIndex;
		let end = this.cursorIndex;
		switch (motion) {
			case "w": end = nextWordStart(this.text, this.cursorIndex, count); break;
			case "b": start = prevWordStart(this.text, this.cursorIndex, count); break;
			case "e": end = Math.min(this.text.length, wordEnd(this.text, this.cursorIndex, count) + 1); break;
			case "0": start = lineStartIndex(this.text, this.cursorIndex); break;
			case "^": start = firstNonBlankIndex(this.text, this.cursorIndex); break;
			case "$": end = lineEndCharIndex(this.text, this.cursorIndex) + 1; break;
			default: return null;
		}
		return { start, end };
	}

	moveCursorByMotion(motion: BufferMotion, count: number): void {
		const range = this.motionRange(motion, count);
		if (!range) return;
		this.cursorIndex = motion === "b" || motion === "0" || motion === "^" ? range.start : range.end;
	}

	deleteMotion(motion: BufferMotion, count: number): string {
		const range = this.motionRange(motion, count);
		if (!range) return "";
		const deleted = this.text.slice(Math.min(range.start, range.end), Math.max(range.start, range.end));
		this.register = { text: deleted, linewise: false };
		this.deleteRange(range.start, range.end);
		return deleted;
	}

	yankMotion(motion: BufferMotion, count: number): string {
		const range = this.motionRange(motion, count);
		if (!range) return "";
		const yanked = this.text.slice(Math.min(range.start, range.end), Math.max(range.start, range.end));
		this.register = { text: yanked, linewise: false };
		return yanked;
	}

	replaceChar(ch: string): void {
		if (this.cursorIndex >= this.text.length) return;
		this.replaceText(this.text.slice(0, this.cursorIndex) + ch + this.text.slice(this.cursorIndex + 1), this.cursorIndex);
	}

	openLineBelow(): void {
		const cursor = indexToCursor(this.text, this.cursorIndex);
		const lines = splitLines(this.text);
		lines.splice(cursor.line + 1, 0, "");
		const next = lines.join("\n");
		this.replaceText(next, textToIndex(next, { line: cursor.line + 1, col: 0 }));
	}

	openLineAbove(): void {
		const cursor = indexToCursor(this.text, this.cursorIndex);
		const lines = splitLines(this.text);
		lines.splice(cursor.line, 0, "");
		const next = lines.join("\n");
		this.replaceText(next, textToIndex(next, { line: cursor.line, col: 0 }));
	}

	joinLine(): void {
		const cursor = indexToCursor(this.text, this.cursorIndex);
		const lines = splitLines(this.text);
		if (cursor.line >= lines.length - 1) return;
		lines[cursor.line] = `${lines[cursor.line] ?? ""} ${lines[cursor.line + 1] ?? ""}`.trimEnd();
		lines.splice(cursor.line + 1, 1);
		const next = lines.join("\n");
		this.replaceText(next, textToIndex(next, { line: cursor.line, col: (lines[cursor.line] ?? "").length }));
	}

	applyRegister(before = false): void {
		if (!this.register.text) return;
		const safe = clamp(this.cursorIndex, 0, this.text.length);
		if (this.register.linewise) {
			const lines = splitLines(this.text);
			const regLines = this.register.text.replace(/\n$/, "").split("\n");
			const pos = indexToCursor(this.text, safe);
			const insertLine = before ? pos.line : pos.line + 1;
			lines.splice(insertLine, 0, ...regLines);
			const next = lines.join("\n");
			this.replaceText(next, textToIndex(next, { line: insertLine, col: 0 }));
			return;
		}
		this.insertAt(before ? safe : Math.min(this.text.length, safe + 1), this.register.text);
	}

	getVisualRange(mode: "visual" | "visual-line", visualAnchor: number): Range {
		if (mode === "visual-line") {
			const a = indexToCursor(this.text, visualAnchor).line;
			const b = indexToCursor(this.text, this.cursorIndex).line;
			const startLine = Math.min(a, b);
			const endLine = Math.max(a, b);
			const lines = splitLines(this.text);
			let start = 0;
			for (let i = 0; i < startLine; i++) start += (lines[i]?.length ?? 0) + 1;
			let end = 0;
			for (let i = 0; i <= endLine; i++) end += (lines[i]?.length ?? 0) + 1;
			if (end > this.text.length) end = this.text.length;
			return { start, end, linewise: true };
		}
		return {
			start: Math.min(visualAnchor, this.cursorIndex),
			end: Math.min(this.text.length, Math.max(visualAnchor, this.cursorIndex) + 1),
			linewise: false,
		};
	}

	textObjectRange(prefix: TextObjectPrefix, kind: TextObjectKind): Range | null {
		if (kind === "w") return expandWordObject(this.text, this.cursorIndex, prefix === "a", false);
		if (kind === "W") return expandWordObject(this.text, this.cursorIndex, prefix === "a", true);
		if (kind === "p") return expandParagraphObject(this.text, this.cursorIndex);
		return null;
	}

	applyRange(range: Range): string {
		const deleted = this.text.slice(range.start, range.end);
		this.register = { text: deleted, linewise: range.linewise };
		this.deleteRange(range.start, range.end);
		return deleted;
	}

	lineBoundsAtCursor(): { start: number; end: number; line: string; lineIndex: number } {
		return lineBounds(this.text, this.cursorIndex);
	}
}
