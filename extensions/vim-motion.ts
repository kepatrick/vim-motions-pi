import { spawnSync } from "node:child_process";

import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import {
	type ClipboardMode,
	type Cursor,
	type FindKind,
	type Range,
	clamp,
	findCharInLine,
	firstNonBlankIndex,
	indexToCursor,
	lineBounds,
	lineEndCharIndex,
	lineStartIndex,
	moveLeftIndex,
	moveRightIndex,
	nextWordStart,
	normalizeClipboardMode,
	prevWordStart,
	normalizeText,
	splitLines,
	textToIndex,
	wordEnd,
} from "./core";
import { type BufferMotion, type Register, type TextObjectKind, type TextObjectPrefix, VimBuffer } from "./buffer";
import { tryClipboardWrite } from "./clipboard";

const clipboardState = {
	mode: normalizeClipboardMode(process.env.VIM_MOTION_PI_CLIPBOARD),
};

function updateClipboardMode(mode: ClipboardMode): void {
	clipboardState.mode = mode;
}

function clipboardModeLabel(): string {
	switch (clipboardState.mode) {
		case "off": return "off";
		case "yank": return "yank only";
		default: return "all operations";
	}
}

function clipboardStatusMessage(): string {
	return `Clipboard sync: ${clipboardModeLabel()} (use /vim-clipboard to change)`;
}

type Mode = "insert" | "normal" | "visual" | "visual-line";
type Operator = "d" | "c" | "y";

function copyToClipboard(text: string): void {
	if (clipboardState.mode === "off" || !text) return;
	tryClipboardWrite(text, process.platform, (command, args, input) => spawnSync(command, args, {
		input,
		encoding: "utf8",
		stdio: ["pipe", "inherit", "ignore"],
	}));
}

type Segment = {
	logicalLine: number;
	startCol: number;
	length: number;
};

type LayoutLine = {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
	logicalLine: number;
	startCol: number;
	length: number;
};

function isPrintable(data: string): boolean {
	return data.length === 1 && data.charCodeAt(0) >= 32;
}

function isDigitKey(data: string): boolean {
	return data.length === 1 && data >= "0" && data <= "9";
}

function shouldPassThroughNormalModeKey(data: string): boolean {
	return matchesKey(data, "ctrl+c")
		|| matchesKey(data, "ctrl+d")
		|| matchesKey(data, "enter")
		|| matchesKey(data, "tab")
		|| matchesKey(data, "ctrl+l")
		|| matchesKey(data, "ctrl+p")
		|| matchesKey(data, "ctrl+shift+p")
		|| matchesKey(data, "ctrl+o")
		|| matchesKey(data, "ctrl+t")
		|| matchesKey(data, "shift+tab");
}

function currentIndex(editor: CustomEditor): number {
	return textToIndex(editor.getText(), editor.getCursor());
}

function setInternalCursor(editor: CustomEditor, index: number): void {
	const anyEditor = editor as any;
	const text = editor.getText();
	const cursor = indexToCursor(text, index);
	anyEditor.state.cursorLine = cursor.line;
	anyEditor.state.cursorCol = cursor.col;
	anyEditor.state.lines = splitLines(text);
	anyEditor.tui?.requestRender?.();
}

function replaceText(editor: CustomEditor, nextText: string, cursorIndex: number): void {
	editor.setText(normalizeText(nextText));
	setInternalCursor(editor, cursorIndex);
}

function insertAt(editor: CustomEditor, index: number, insertText: string): void {
	const text = editor.getText();
	const safe = clamp(index, 0, text.length);
	replaceText(editor, text.slice(0, safe) + insertText + text.slice(safe), safe + insertText.length);
}

function deleteRange(editor: CustomEditor, start: number, end: number): string {
	const text = editor.getText();
	const a = clamp(Math.min(start, end), 0, text.length);
	const b = clamp(Math.max(start, end), 0, text.length);
	const deleted = text.slice(a, b);
	replaceText(editor, text.slice(0, a) + text.slice(b), a);
	return deleted;
}

function linewiseText(line: string): string {
	return `${line}\n`;
}

function lineRangeForIndex(text: string, index: number): { start: number; end: number; line: string; lineIndex: number } {
	return lineBounds(text, index);
}

function rangeFromSelection(editor: VimEditor): Range | null {
	return editor.getSelectionRange();
}

function selectedLines(range: Range, text: string): Set<number> {
	const lines = new Set<number>();
	const startCursor = indexToCursor(text, range.start);
	const endCursor = indexToCursor(text, Math.max(range.start, Math.max(range.end - 1, range.start)));
	for (let i = startCursor.line; i <= endCursor.line; i++) lines.add(i);
	return lines;
}

function highlight(text: string, start: number, end: number): string {
	if (start >= end) return text;
	return `${text.slice(0, start)}\x1b[7m${text.slice(start, end)}\x1b[27m${text.slice(end)}`;
}

function splitAtVisibleColumn(text: string, column: number): [string, string] {
	if (column <= 0) return ["", text];
	let visible = 0;
	for (let i = 0; i < text.length; ) {
		if (visible === column) return [text.slice(0, i), text.slice(i)];
		if (text.startsWith(CURSOR_MARKER, i)) {
			i += CURSOR_MARKER.length;
			continue;
		}
		const ansi = text.slice(i).match(/^\x1b\[[0-?]*[ -\/]*[@-~]/);
		if (ansi) {
			i += ansi[0].length;
			continue;
		}
		visible++;
		i++;
	}
	return [text, ""];
}

class VimEditor extends CustomEditor {
	private mode: Mode = "insert";
	private count = "";
	private operator: Operator | null = null;
	private pendingFind: FindKind | null = null;
	private pendingG = false;
	private pendingReplace = false;
	private pendingObjectPrefix: TextObjectPrefix | null = null;
	private pendingTextObjectOp: Operator | null = null;
	private pendingTextObject: TextObjectKind | null = null;
	private lastFind: { kind: FindKind; ch: string; count: number } | null = null;
	private register: Register = { text: "", linewise: false };
	private visualAnchor: number = 0;
	private escapeBuffer: string = "";

	private getEscapeSequence(): string | null {
		const env = process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE;
		if (!env) return null;
		const seq = env.trim();
		return seq.length >= 2 ? seq : null;
	}

	private renderIsFocused(): boolean {
		return !!(this as any).focused;
	}

	private requestRender(): void {
		;(this as any).tui?.requestRender?.();
	}

	private setMode(mode: Mode): void {
		this.mode = mode;
		this.requestRender();
	}

	private setCursorIndex(index: number): void {
		setInternalCursor(this, index);
	}

	private cursorIndex(): number {
		return currentIndex(this);
	}

	private getCount(): number {
		if (this.count.length === 0) return 1;
		const n = Number.parseInt(this.count, 10);
		return Number.isFinite(n) && n > 0 ? n : 1;
	}

	private createBuffer(): VimBuffer {
		return new VimBuffer(this.getText(), this.cursorIndex(), this.register);
	}

	private applyBuffer(buffer: VimBuffer, copyKind: "yank" | "delete" | "change" | null = null): void {
		replaceText(this, buffer.text, buffer.cursorIndex);
		this.register = { ...buffer.register };
		if (copyKind && this.shouldCopyToClipboard(copyKind)) copyToClipboard(buffer.register.text);
	}

	private shouldCopyToClipboard(copyKind: "yank" | "delete" | "change"): boolean {
		return clipboardState.mode === "all" || (clipboardState.mode === "yank" && copyKind === "yank");
	}

	private setRegister(text: string, linewise: boolean, copyKind: "yank" | "delete" | "change" | null = "yank"): void {
		this.register = { text, linewise };
		if (copyKind && this.shouldCopyToClipboard(copyKind)) copyToClipboard(text);
	}

	private resetPending(): void {
		this.count = "";
		this.operator = null;
		this.pendingFind = null;
		this.pendingG = false;
		this.pendingReplace = false;
		this.pendingObjectPrefix = null;
		this.pendingTextObjectOp = null;
		this.pendingTextObject = null;
	}

	private enterVisual(linewise = false): void {
		this.mode = linewise ? "visual-line" : "visual";
		this.visualAnchor = this.cursorIndex();
		if (linewise) {
			const text = this.getText();
			const cursor = this.cursorIndex();
			const bounds = lineBounds(text, cursor);
			this.visualAnchor = bounds.start;
			this.setCursorIndex(bounds.end);
		}
		this.requestRender();
	}

	private exitVisual(): void {
		this.mode = "normal";
		this.pendingObjectPrefix = null;
		this.pendingTextObjectOp = null;
		this.pendingTextObject = null;
		this.requestRender();
	}

	private swapVisualEnds(): void {
		const cur = this.cursorIndex();
		const anchor = this.visualAnchor;
		this.visualAnchor = cur;
		this.setCursorIndex(anchor);
	}

	private getVisualRange(): Range | null {
		if (this.mode !== "visual" && this.mode !== "visual-line") return null;
		return this.createBuffer().getVisualRange(this.mode, this.visualAnchor);
	}

	getSelectionRange(): Range | null {
		return this.getVisualRange();
	}

	private moveByMotion(kind: string, count: number): void {
		const text = this.getText();
		const index = this.cursorIndex();
		let next = index;

		switch (kind) {
			case "h": next = moveLeftIndex(index, count); break;
			case "l": next = moveRightIndex(text, index, count); break;
			case "j":
				for (let i = 0; i < count; i++) super.handleInput("\x1b[B");
				return;
			case "k":
				for (let i = 0; i < count; i++) super.handleInput("\x1b[A");
				return;
			case "0": next = lineStartIndex(text, index); break;
			case "^": next = firstNonBlankIndex(text, index); break;
			case "$": next = lineEndCharIndex(text, index); break;
			case "w": next = nextWordStart(text, index, count); break;
			case "b": next = prevWordStart(text, index, count); break;
			case "e": next = wordEnd(text, index, count); break;
			case "g": {
				const lines = splitLines(text);
				const line = clamp(count - 1, 0, Math.max(0, lines.length - 1));
				let idx = 0;
				for (let i = 0; i < line; i++) idx += (lines[i]?.length ?? 0) + 1;
				next = idx;
				break;
			}
			case "G": {
				const lines = splitLines(text);
				const line = count > 1 ? clamp(count - 1, 0, Math.max(0, lines.length - 1)) : Math.max(0, lines.length - 1);
				let idx = 0;
				for (let i = 0; i < line; i++) idx += (lines[i]?.length ?? 0) + 1;
				next = idx;
				break;
			}
			default: return;
	}

		this.setCursorIndex(next);
	}

	private replaceChar(ch: string): void {
		const buffer = this.createBuffer();
		buffer.replaceChar(ch);
		this.applyBuffer(buffer);
	}

	private openLineBelow(): void {
		const buffer = this.createBuffer();
		buffer.openLineBelow();
		this.applyBuffer(buffer);
		this.setMode("insert");
	}

	private openLineAbove(): void {
		const buffer = this.createBuffer();
		buffer.openLineAbove();
		this.applyBuffer(buffer);
		this.setMode("insert");
	}

	private deleteLine(count = 1, keepRegister = true): void {
		const buffer = this.createBuffer();
		buffer.deleteLine(count);
		this.applyBuffer(buffer, keepRegister ? "delete" : null);
	}

	private yankLine(count = 1): void {
		const buffer = this.createBuffer();
		buffer.yankLine(count);
		this.register = { ...buffer.register };
		if (this.shouldCopyToClipboard("yank")) copyToClipboard(buffer.register.text);
	}

	private deleteCurrentChar(count: number): void {
		const buffer = this.createBuffer();
		buffer.deleteCurrentChar(count);
		this.applyBuffer(buffer, "delete");
	}

	private deleteBackwardChar(count: number): void {
		const buffer = this.createBuffer();
		buffer.deleteBackwardChar(count);
		this.applyBuffer(buffer, "delete");
	}

	private deleteMotion(motion: BufferMotion, count: number): void {
		const buffer = this.createBuffer();
		buffer.deleteMotion(motion, count);
		this.applyBuffer(buffer, "delete");
	}

	private yankMotion(motion: BufferMotion, count: number): void {
		const buffer = this.createBuffer();
		buffer.yankMotion(motion, count);
		this.register = { ...buffer.register };
		if (this.shouldCopyToClipboard("yank")) copyToClipboard(buffer.register.text);
	}

	private changeMotion(motion: string, count: number): void {
		this.deleteMotion(motion, count);
		this.setMode("insert");
	}

	private substituteChar(count: number): void {
		this.deleteCurrentChar(count);
		this.setMode("insert");
	}

	private substituteLine(count = 1): void {
		this.deleteLine(count, true);
		this.setMode("insert");
	}

	private joinLine(): void {
		const buffer = this.createBuffer();
		buffer.joinLine();
		this.applyBuffer(buffer);
	}

	private applyRegisterAt(index: number, linewise: boolean, before = false): void {
		const buffer = new VimBuffer(this.getText(), index, { text: this.register.text, linewise });
		buffer.applyRegister(before);
		this.applyBuffer(buffer);
	}

	private deleteSelectionToRegister(): Range | null {
		const range = this.getSelectionRange();
		if (!range) return null;
		this.setRegister(this.getText().slice(range.start, range.end), range.linewise, "delete");
		deleteRange(this, range.start, range.end);
		return range;
	}

	private replaceSelection(): void {
		const savedRegister = { ...this.register };
		const range = this.getSelectionRange();
		if (!range) return;
		deleteRange(this, range.start, range.end);
		this.setRegister(savedRegister.text, savedRegister.linewise, null);
		if (savedRegister.linewise) {
			this.applyRegisterAt(range.start, true, true);
		} else {
			insertAt(this, range.start, savedRegister.text);
		}
	}

	private moveSelectionByObject(prefix: TextObjectPrefix, kind: TextObjectKind): void {
		const range = this.createBuffer().textObjectRange(prefix, kind);
		if (!range) return;
		this.visualAnchor = range.start;
		this.setCursorIndex(Math.max(range.start, range.end - 1));
	}

	private applyOperatorToSelection(op: Operator): void {
		const range = this.getSelectionRange();
		if (!range) return;
		const deleted = this.getText().slice(range.start, range.end);
		this.setRegister(deleted, range.linewise, op === "y" ? "yank" : "delete");
		if (op === "y") {
			this.setMode("normal");
			return;
		}
		deleteRange(this, range.start, range.end);
		this.setCursorIndex(range.start);
		if (op === "c") this.setMode("insert");
		else this.setMode("normal");
	}

	private performTextObject(prefix: TextObjectPrefix, kind: TextObjectKind): void {
		const buffer = this.createBuffer();
		const range = buffer.textObjectRange(prefix, kind);
		if (!range) return;
		const op = this.pendingTextObjectOp ?? this.operator;
		this.pendingTextObjectOp = null;
		if (op) {
			buffer.applyRange(range);
			this.applyBuffer(buffer, op === "y" ? "yank" : "delete");
			this.setCursorIndex(range.start);
			if (op === "c") this.setMode("insert");
			else this.setMode("normal");
			return;
		}
		if (this.mode === "visual" || this.mode === "visual-line") {
			this.visualAnchor = range.start;
			this.setCursorIndex(Math.max(range.start, range.end - 1));
		}
	}

	private renderHighlight(text: string, range: Range | null, lineNo: number, segmentStart: number, segmentEnd: number): string {
		let out = text;
		if (range) {
			if (range.linewise) {
				const startLine = indexToCursor(this.getText(), range.start).line;
				const endLine = indexToCursor(this.getText(), Math.max(range.end - 1, range.start)).line;
				if (lineNo >= startLine && lineNo <= endLine) {
					out = `\x1b[7m${out}\x1b[27m`;
				}
			} else {
				const a = Math.max(range.start, segmentStart);
				const b = Math.min(range.end, segmentEnd);
				if (a < b) {
					const relA = a - segmentStart;
					const relB = b - segmentStart;
					out = highlight(out, relA, relB);
				}
			}
		}
		return out;
	}

	private renderVisual(width: number): string[] {
		const paddingX = this.getPaddingX();
		const contentWidth = Math.max(1, width - paddingX * 2);
		const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
		(this as any).lastWidth = layoutWidth;
		const border = this.borderColor("─");
		const visualRange = this.getSelectionRange();
		const segments = ((this as any).buildVisualLineMap?.(layoutWidth) ?? []) as Segment[];
		const result: string[] = [];
		const leftPadding = " ".repeat(paddingX);
		const rightPadding = leftPadding;
		const terminalRows = (this as any).tui?.terminal?.rows ?? 24;
		const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));
		const cursor = this.getCursor();
		const cursorIndex = this.cursorIndex();

		const layoutLines: LayoutLine[] = [];
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i]!;
			const next = segments[i + 1];
			const line = this.getLines()[seg.logicalLine] ?? "";
			const text = line.slice(seg.startCol, seg.startCol + seg.length);
			const segStart = textToIndex(this.getText(), { line: seg.logicalLine, col: seg.startCol });
			const segEnd = segStart + text.length;
			const display = this.renderHighlight(text, visualRange, seg.logicalLine, segStart, segEnd);
			const within = cursor.line === seg.logicalLine && cursor.col >= seg.startCol && cursor.col < seg.startCol + seg.length;
			const atEnd = cursor.line === seg.logicalLine && cursor.col === seg.startCol + seg.length && (!next || next.logicalLine !== seg.logicalLine);
			const cursorHit = within || atEnd;
			layoutLines.push({ text: display, hasCursor: cursorHit, cursorPos: cursorHit ? cursor.col - seg.startCol : undefined, logicalLine: seg.logicalLine, startCol: seg.startCol, length: seg.length });
		}

		if (layoutLines.length === 0) layoutLines.push({ text: "", hasCursor: true, cursorPos: 0, logicalLine: 0, startCol: 0, length: 0 });
		let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
		if (cursorLineIndex === -1) cursorLineIndex = 0;
		const scrollOffset = (this as any).scrollOffset ?? 0;
		let finalScroll = scrollOffset;
		if (cursorLineIndex < finalScroll) finalScroll = cursorLineIndex;
		else if (cursorLineIndex >= finalScroll + maxVisibleLines) finalScroll = cursorLineIndex - maxVisibleLines + 1;
		const maxScroll = Math.max(0, layoutLines.length - maxVisibleLines);
		finalScroll = Math.max(0, Math.min(finalScroll, maxScroll));
		(this as any).scrollOffset = finalScroll;
		const visibleLines = layoutLines.slice(finalScroll, finalScroll + maxVisibleLines);

		if (finalScroll > 0) {
			const indicator = `─── ↑ ${finalScroll} more `;
			const remain = width - visibleWidth(indicator);
			result.push(remain >= 0 ? this.borderColor(indicator + "─".repeat(remain)) : this.borderColor(truncateToWidth(indicator, width)));
		} else {
			result.push(border.repeat(width));
		}

		const emitCursorMarker = this.renderIsFocused() && !(this as any).autocompleteState;
		for (const line of visibleLines) {
			let displayText = line.text;
			let lineVisibleWidth = visibleWidth(displayText);
			let cursorInPadding = false;
			if (line.hasCursor && line.cursorPos !== undefined) {
				const [before, after] = splitAtVisibleColumn(displayText, line.cursorPos);
				const marker = emitCursorMarker ? CURSOR_MARKER : "";
				if (after.length > 0) {
					const [cursorChar, rest] = splitAtVisibleColumn(after, 1);
					displayText = before + marker + `\x1b[4m${cursorChar}\x1b[24m` + rest;
				} else {
					displayText = before + marker + `\x1b[4m \x1b[24m`;
					lineVisibleWidth += 1;
					if (lineVisibleWidth > contentWidth && paddingX > 0) cursorInPadding = true;
				}
			}
			const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));
			const rightPad = cursorInPadding ? rightPadding.slice(1) : rightPadding;
			result.push(`${leftPadding}${displayText}${padding}${rightPad}`);
		}

		const linesBelow = layoutLines.length - (finalScroll + visibleLines.length);
		if (linesBelow > 0) {
			const indicator = `─── ↓ ${linesBelow} more `;
			const remain = width - visibleWidth(indicator);
			result.push(this.borderColor(indicator + "─".repeat(Math.max(0, remain))));
		} else {
			result.push(border.repeat(width));
		}

		const label = this.mode === "visual-line" ? " VISUAL LINE " : " VISUAL ";
		const last = result.length - 1;
		if (visibleWidth(result[last]!) >= label.length) {
			result[last] = truncateToWidth(result[last]!, width - label.length, "") + label;
		}
		return result;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			if (this.mode === "insert") {
				this.setMode("normal");
				return;
			}
			if (this.mode === "visual" || this.mode === "visual-line") {
				this.exitVisual();
				return;
			}
			this.resetPending();
			super.handleInput(data);
			return;
		}

		if (this.mode === "insert") {
			const seq = this.getEscapeSequence();
			if (seq) {
				this.escapeBuffer += data;
				if (this.escapeBuffer.endsWith(seq)) {
					// Remove the escape sequence characters from the buffer
					const toRemove = seq.length;
					for (let i = 0; i < toRemove - 1; i++) {
						super.handleInput("\x7f"); // backspace
					}
					this.escapeBuffer = "";
					this.setMode("normal");
					return;
				}
				// Only keep the last N characters where N = sequence length
				if (this.escapeBuffer.length > seq.length) {
					this.escapeBuffer = this.escapeBuffer.slice(-seq.length);
				}
			}
			super.handleInput(data);
			return;
		}

		if (shouldPassThroughNormalModeKey(data)) {
			super.handleInput(data);
			return;
		}

		if (this.pendingFind) {
			if (isPrintable(data)) {
				const kind = this.pendingFind;
				const count = this.getCount();
				const next = findCharInLine(this.getText(), this.cursorIndex(), kind, data, count);
				this.lastFind = { kind, ch: data, count };
				this.setCursorIndex(next);
			}
			this.pendingFind = null;
			this.count = "";
			return;
		}

		if (this.pendingReplace) {
			if (isPrintable(data)) this.replaceChar(data);
			this.pendingReplace = false;
			this.count = "";
			return;
		}

		if (this.pendingG) {
			this.pendingG = false;
			if (data === "g") {
				this.moveByMotion("g", this.getCount());
				this.count = "";
				return;
			}
			this.handleInput(data);
			return;
		}

		if (this.pendingObjectPrefix) {
			if (data === "w" || data === "W" || data === "p" || data === '"' || data === "'") {
				this.pendingTextObject = data as TextObjectKind;
				this.performTextObject(this.pendingObjectPrefix, this.pendingTextObject);
			}
			this.pendingObjectPrefix = null;
			this.pendingTextObject = null;
			this.pendingTextObjectOp = null;
			this.count = "";
			return;
		}

		if (this.operator) {
			if (isDigitKey(data)) {
				this.count += data;
				return;
			}
			const op = this.operator;
			const count = this.getCount();
			this.operator = null;
			this.count = "";

			if (data === op) {
				if (op === "d") this.deleteLine(count, true);
				if (op === "y") this.yankLine(count);
				if (op === "c") this.deleteLine(count, true);
				if (op === "c") this.setMode("insert");
				return;
			}

			if (data === "i" || data === "a") {
				this.pendingObjectPrefix = data as TextObjectPrefix;
				this.pendingTextObjectOp = op;
				return;
			}

			if (data === "w" || data === "b" || data === "e" || data === "0" || data === "^" || data === "$") {
				if (op === "d") this.deleteMotion(data, count);
				if (op === "y") this.yankMotion(data, count);
				if (op === "c") this.changeMotion(data, count);
				if (op === "c") this.setMode("insert");
				return;
			}

			this.handleInput(data);
			return;
		}

		if (this.mode === "visual" || this.mode === "visual-line") {
			if (data === "o") {
				this.swapVisualEnds();
				return;
			}
			if (data === "d" || data === "y" || data === "c") {
				const op = data as Operator;
				this.applyOperatorToSelection(op);
				return;
			}
			if (data === "p" || data === "P") {
				const range = this.getSelectionRange();
				if (!range) return;
				const savedRegister = { ...this.register };
				deleteRange(this, range.start, range.end);
				this.setRegister(savedRegister.text, savedRegister.linewise, null);
				if (savedRegister.linewise) this.applyRegisterAt(range.start, true, true);
				else insertAt(this, range.start, savedRegister.text);
				this.exitVisual();
				return;
			}
			if (data === "i" || data === "a") {
				this.pendingObjectPrefix = data as TextObjectPrefix;
				return;
			}
			if (data === "v") {
				this.exitVisual();
				return;
			}
			if (data === "V") {
				this.mode = "visual-line";
				return;
			}
			const count = this.getCount();
			if (data === "g") {
				this.pendingG = true;
				return;
			}
			switch (data) {
				case "h": case "j": case "k": case "l": case "w": case "b": case "e": case "0": case "^": case "$": case "g": case "G":
					this.moveByMotion(data, count);
					this.count = "";
					return;
			}
			if (data === "f" || data === "F" || data === "t" || data === "T") {
				this.pendingFind = data as FindKind;
				return;
			}
			if (data === "r") {
				this.pendingReplace = true;
				return;
			}
			if (data === "u") {
				super.handleInput("\x1f");
				return;
			}
			if (shouldPassThroughNormalModeKey(data)) {
				super.handleInput(data);
			}
			return;
		}

		if (isDigitKey(data)) {
			if (data === "0" && this.count.length === 0) {
				this.moveByMotion("0", 1);
				return;
			}
			this.count += data;
			return;
		}

		const count = this.getCount();
		switch (data) {
			case "h": case "j": case "k": case "l": case "w": case "b": case "e": case "0": case "^": case "$": case "G":
				this.moveByMotion(data, count);
				this.count = "";
				return;
			case "g":
				this.pendingG = true;
				return;
			case "v":
				this.enterVisual(false);
				this.count = "";
				return;
			case "V":
				this.enterVisual(true);
				this.count = "";
				return;
			case "i":
				this.setMode("insert");
				this.count = "";
				return;
			case "a":
				this.moveByMotion("l", 1);
				this.setMode("insert");
				this.count = "";
				return;
			case "I":
				this.setCursorIndex(firstNonBlankIndex(this.getText(), this.cursorIndex()));
				this.setMode("insert");
				this.count = "";
				return;
			case "A":
				this.setCursorIndex(lineEndCharIndex(this.getText(), this.cursorIndex()) + 1);
				this.setMode("insert");
				this.count = "";
				return;
			case "o":
				this.openLineBelow();
				this.count = "";
				return;
			case "O":
				this.openLineAbove();
				this.count = "";
				return;
			case "x":
				this.deleteCurrentChar(count);
				this.count = "";
				return;
			case "X":
				this.deleteBackwardChar(count);
				this.count = "";
				return;
			case "d":
			case "c":
			case "y":
				this.operator = data as Operator;
				return;
			case "s":
				this.substituteChar(count);
				this.count = "";
				return;
			case "S":
				this.substituteLine(count);
				this.count = "";
				return;
			case "D":
				this.deleteMotion("$", 1);
				this.count = "";
				return;
			case "C":
				this.changeMotion("$", 1);
				this.count = "";
				return;
			case "Y":
				this.yankLine(count);
				this.count = "";
				return;
			case "p":
				this.applyRegisterAt(this.cursorIndex(), this.register.linewise, false);
				this.count = "";
				return;
			case "P":
				this.applyRegisterAt(this.cursorIndex(), this.register.linewise, true);
				this.count = "";
				return;
			case "u":
				super.handleInput("\x1f");
				this.count = "";
				return;
			case "r":
				this.pendingReplace = true;
				return;
			case "f": case "F": case "t": case "T":
				this.pendingFind = data as FindKind;
				return;
			case ";":
				if (this.lastFind) this.setCursorIndex(findCharInLine(this.getText(), this.cursorIndex(), this.lastFind.kind, this.lastFind.ch, this.lastFind.count));
				this.count = "";
				return;
			case ",":
				if (this.lastFind) {
					const rev: FindKind = this.lastFind.kind === "f" ? "F" : this.lastFind.kind === "F" ? "f" : this.lastFind.kind === "t" ? "T" : "t";
					this.setCursorIndex(findCharInLine(this.getText(), this.cursorIndex(), rev, this.lastFind.ch, this.lastFind.count));
				}
				this.count = "";
				return;
			case ".":
				return;
			case "J":
				this.joinLine();
				this.count = "";
				return;
			default:
				if (matchesKey(data, "ctrl+c") || matchesKey(data, "ctrl+d") || matchesKey(data, "enter") || matchesKey(data, "tab")) {
					super.handleInput(data);
				}
				this.count = "";
				return;
		}
	}

	render(width: number): string[] {
		if (this.mode === "visual" || this.mode === "visual-line") return this.renderVisual(width);
		const lines = super.render(width);
		if (lines.length === 0) return lines;
		const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
		const last = lines.length - 1;
		if (visibleWidth(lines[last]!) >= label.length) {
			lines[last] = truncateToWidth(lines[last]!, width - label.length, "") + label;
		}
		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("vim-clipboard", {
		description: "Choose clipboard sync mode",
		handler: async (_args, ctx) => {
			const choice = await ctx.ui.select("Clipboard sync mode:", ["Off", "All operations", "Yank only"]);
			if (!choice) return;
			if (choice === "Off") updateClipboardMode("off");
			else if (choice === "All operations") updateClipboardMode("all");
			else updateClipboardMode("yank");
			ctx.ui.notify(clipboardStatusMessage(), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimEditor(tui, theme, keybindings));
		ctx.ui.notify(clipboardStatusMessage(), "info");
	});
}
