import { findCharInLine, type FindKind } from "./core";
import { type BufferMotion, type Register, type TextObjectKind, type TextObjectPrefix, VimBuffer } from "./buffer";

export type Mode = "insert" | "normal" | "visual" | "visual-line";
export type Operator = "d" | "c" | "y";

export type HarnessState = {
	text: string;
	cursorIndex: number;
	mode: Mode;
	count: string;
	operator: Operator | null;
	pendingFind: FindKind | null;
	pendingG: boolean;
	pendingReplace: boolean;
	pendingObjectPrefix: TextObjectPrefix | null;
	pendingTextObjectOp: Operator | null;
	pendingTextObject: TextObjectKind | null;
	lastFind: { kind: FindKind; ch: string; count: number } | null;
	register: Register;
	visualAnchor: number;
};

export function createHarnessState(text: string, cursorIndex = 0): HarnessState {
	return {
		text,
		cursorIndex,
		mode: "insert",
		count: "",
		operator: null,
		pendingFind: null,
		pendingG: false,
		pendingReplace: false,
		pendingObjectPrefix: null,
		pendingTextObjectOp: null,
		pendingTextObject: null,
		lastFind: null,
		register: { text: "", linewise: false },
		visualAnchor: 0,
	};
}

function getCount(state: HarnessState): number {
	if (state.count.length === 0) return 1;
	const n = Number.parseInt(state.count, 10);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

function isDigitKey(data: string): boolean {
	return data.length === 1 && data >= "0" && data <= "9";
}

function isPrintable(data: string): boolean {
	return data.length === 1 && data.charCodeAt(0) >= 32;
}

function applyBuffer(state: HarnessState, buffer: VimBuffer): void {
	state.text = buffer.text;
	state.cursorIndex = buffer.cursorIndex;
	state.register = { ...buffer.register };
}

function createBuffer(state: HarnessState): VimBuffer {
	return new VimBuffer(state.text, state.cursorIndex, state.register);
}

function enterVisual(state: HarnessState, linewise = false): void {
	state.mode = linewise ? "visual-line" : "visual";
	state.visualAnchor = state.cursorIndex;
	if (linewise) {
		const buffer = createBuffer(state);
		const bounds = buffer.lineBoundsAtCursor();
		state.visualAnchor = bounds.start;
		state.cursorIndex = bounds.end;
	}
}

function exitVisual(state: HarnessState): void {
	state.mode = "normal";
	state.pendingObjectPrefix = null;
	state.pendingTextObjectOp = null;
	state.pendingTextObject = null;
}

function swapVisualEnds(state: HarnessState): void {
	const cur = state.cursorIndex;
	state.cursorIndex = state.visualAnchor;
	state.visualAnchor = cur;
}

function applyVisualOperator(state: HarnessState, op: Operator): void {
	const buffer = createBuffer(state);
	const range = buffer.getVisualRange(state.mode === "visual-line" ? "visual-line" : "visual", state.visualAnchor);
	const selected = buffer.text.slice(range.start, range.end);
	if (op === "y") {
		state.register = { text: selected, linewise: range.linewise };
		exitVisual(state);
		return;
	}
	buffer.applyRange(range);
	applyBuffer(state, buffer);
	state.cursorIndex = range.start;
	state.mode = op === "c" ? "insert" : "normal";
}

function replaceVisualSelection(state: HarnessState, before: boolean): void {
	const savedRegister = { ...state.register };
	const buffer = createBuffer(state);
	const range = buffer.getVisualRange(state.mode === "visual-line" ? "visual-line" : "visual", state.visualAnchor);
	buffer.applyRange(range);
	buffer.register = savedRegister;
	buffer.cursorIndex = range.start;
	buffer.applyRegister(before);
	applyBuffer(state, buffer);
	state.register = savedRegister;
	state.mode = "normal";
}

function resetPending(state: HarnessState): void {
	state.count = "";
	state.operator = null;
	state.pendingFind = null;
	state.pendingG = false;
	state.pendingReplace = false;
	state.pendingObjectPrefix = null;
	state.pendingTextObjectOp = null;
	state.pendingTextObject = null;
}

function moveByMotion(state: HarnessState, motion: BufferMotion): void {
	const buffer = createBuffer(state);
	buffer.moveCursorByMotion(motion, getCount(state));
	applyBuffer(state, buffer);
}

function applyOperatorMotion(state: HarnessState, op: Operator, motion: BufferMotion): void {
	const buffer = createBuffer(state);
	const count = getCount(state);
	if (op === "d") buffer.deleteMotion(motion, count);
	if (op === "y") buffer.yankMotion(motion, count);
	if (op === "c") buffer.deleteMotion(motion, count);
	applyBuffer(state, buffer);
	if (op === "c") state.mode = "insert";
}

function applyTextObject(state: HarnessState, prefix: TextObjectPrefix, kind: TextObjectKind): void {
	const buffer = createBuffer(state);
	const range = buffer.textObjectRange(prefix, kind);
	if (!range) return;
	const op = state.pendingTextObjectOp ?? state.operator;
	state.pendingTextObjectOp = null;
	if (op) {
		if (op === "y") {
			state.register = { text: state.text.slice(range.start, range.end), linewise: range.linewise };
			state.mode = "normal";
			state.cursorIndex = range.start;
			return;
		}
		buffer.applyRange(range);
		applyBuffer(state, buffer);
		state.cursorIndex = range.start;
		state.mode = op === "c" ? "insert" : "normal";
		return;
	}
	if (state.mode === "visual" || state.mode === "visual-line") {
		state.visualAnchor = range.start;
		state.cursorIndex = Math.max(range.start, range.end - 1);
	}
}

export function runKey(state: HarnessState, data: string): HarnessState {
	if (data === "escape") {
		if (state.mode === "insert") {
			state.mode = "normal";
			return state;
		}
		resetPending(state);
		return state;
	}

	if (state.mode === "insert") {
		if (isPrintable(data)) {
			const buffer = createBuffer(state);
			buffer.insertAt(state.cursorIndex, data);
			applyBuffer(state, buffer);
		}
		return state;
	}

	if (state.pendingFind) {
		if (isPrintable(data)) {
			const count = getCount(state);
			state.cursorIndex = findCharInLine(state.text, state.cursorIndex, state.pendingFind, data, count);
			state.lastFind = { kind: state.pendingFind, ch: data, count };
		}
		state.pendingFind = null;
		state.count = "";
		return state;
	}

	if (state.pendingReplace) {
		if (isPrintable(data)) {
			const buffer = createBuffer(state);
			buffer.replaceChar(data);
			applyBuffer(state, buffer);
		}
		state.pendingReplace = false;
		state.count = "";
		return state;
	}

	if (state.pendingG) {
		state.pendingG = false;
		if (data === "g") {
			const lines = state.text.split("\n");
			const line = Math.max(0, Math.min(getCount(state) - 1, Math.max(0, lines.length - 1)));
			let idx = 0;
			for (let i = 0; i < line; i++) idx += (lines[i]?.length ?? 0) + 1;
			state.cursorIndex = idx;
			state.count = "";
			return state;
		}
	}

	if (state.pendingObjectPrefix) {
		if (data === "w" || data === "W" || data === "p") applyTextObject(state, state.pendingObjectPrefix, data as TextObjectKind);
		state.pendingObjectPrefix = null;
		state.pendingTextObject = null;
		state.pendingTextObjectOp = null;
		state.count = "";
		return state;
	}

	if (state.operator) {
		if (isDigitKey(data)) {
			state.count += data;
			return state;
		}
		const op = state.operator;
		state.operator = null;
		if (data === op) {
			const buffer = createBuffer(state);
			if (op === "d" || op === "c") buffer.deleteLine(getCount(state));
			if (op === "y") buffer.yankLine(getCount(state));
			applyBuffer(state, buffer);
			if (op === "c") state.mode = "insert";
			state.count = "";
			return state;
		}
		if (data === "i" || data === "a") {
			state.pendingObjectPrefix = data as TextObjectPrefix;
			state.pendingTextObjectOp = op;
			return state;
		}
		if (data === "w" || data === "b" || data === "e" || data === "0" || data === "^" || data === "$") {
			applyOperatorMotion(state, op, data as BufferMotion);
			state.count = "";
			return state;
		}
	}

	if (state.mode === "visual" || state.mode === "visual-line") {
		if (data === "o") {
			swapVisualEnds(state);
			return state;
		}
		if (data === "d" || data === "y" || data === "c") {
			applyVisualOperator(state, data as Operator);
			return state;
		}
		if (data === "p" || data === "P") {
			replaceVisualSelection(state, data === "P");
			return state;
		}
		if (data === "i" || data === "a") {
			state.pendingObjectPrefix = data as TextObjectPrefix;
			return state;
		}
		if (data === "v") {
			exitVisual(state);
			return state;
		}
		if (data === "V") {
			state.mode = "visual-line";
			return state;
		}
		if (isDigitKey(data)) {
			state.count += data;
			return state;
		}
		if (data === "w" || data === "b" || data === "e" || data === "0" || data === "^" || data === "$") {
			moveByMotion(state, data as BufferMotion);
			state.count = "";
			return state;
		}
	}

	if (isDigitKey(data)) {
		state.count += data;
		return state;
	}

	if (data === "w" || data === "b" || data === "e" || data === "0" || data === "^" || data === "$") {
		moveByMotion(state, data as BufferMotion);
		state.count = "";
		return state;
	}

	if (data === "g") {
		state.pendingG = true;
		return state;
	}

	if (data === "G") {
		const lines = state.text.split("\n");
		const line = getCount(state) > 1 ? Math.max(0, Math.min(getCount(state) - 1, Math.max(0, lines.length - 1))) : Math.max(0, lines.length - 1);
		let idx = 0;
		for (let i = 0; i < line; i++) idx += (lines[i]?.length ?? 0) + 1;
		state.cursorIndex = idx;
		state.count = "";
		return state;
	}

	switch (data) {
		case "i": state.mode = "insert"; state.count = ""; return state;
		case "a": state.cursorIndex = Math.min(state.text.length, state.cursorIndex + 1); state.mode = "insert"; state.count = ""; return state;
		case "o": {
			const buffer = createBuffer(state);
			buffer.openLineBelow();
			applyBuffer(state, buffer);
			state.mode = "insert";
			state.count = "";
			return state;
		}
		case "O": {
			const buffer = createBuffer(state);
			buffer.openLineAbove();
			applyBuffer(state, buffer);
			state.mode = "insert";
			state.count = "";
			return state;
		}
		case "x": {
			const buffer = createBuffer(state);
			buffer.deleteCurrentChar(getCount(state));
			applyBuffer(state, buffer);
			state.count = "";
			return state;
		}
		case "X": {
			const buffer = createBuffer(state);
			buffer.deleteBackwardChar(getCount(state));
			applyBuffer(state, buffer);
			state.count = "";
			return state;
		}
		case "p": {
			const buffer = createBuffer(state);
			buffer.applyRegister(false);
			applyBuffer(state, buffer);
			state.count = "";
			return state;
		}
		case "P": {
			const buffer = createBuffer(state);
			buffer.applyRegister(true);
			applyBuffer(state, buffer);
			state.count = "";
			return state;
		}
		case "d":
		case "c":
		case "y":
			state.operator = data as Operator;
			return state;
		case "r":
			state.pendingReplace = true;
			return state;
		case "J": {
			const buffer = createBuffer(state);
			buffer.joinLine();
			applyBuffer(state, buffer);
			state.count = "";
			return state;
		}
		case "f":
		case "F":
		case "t":
		case "T":
			state.pendingFind = data as FindKind;
			return state;
		case ";":
			if (state.lastFind) state.cursorIndex = findCharInLine(state.text, state.cursorIndex, state.lastFind.kind, state.lastFind.ch, state.lastFind.count);
			state.count = "";
			return state;
		case ",":
			if (state.lastFind) {
				const rev: FindKind = state.lastFind.kind === "f" ? "F" : state.lastFind.kind === "F" ? "f" : state.lastFind.kind === "t" ? "T" : "t";
				state.cursorIndex = findCharInLine(state.text, state.cursorIndex, rev, state.lastFind.ch, state.lastFind.count);
			}
			state.count = "";
			return state;
		case "v": enterVisual(state, false); state.count = ""; return state;
		case "V": enterVisual(state, true); state.count = ""; return state;
	}

	return state;
}

export function runKeys(text: string, keys: string[], cursorIndex = 0): HarnessState {
	const state = createHarnessState(text, cursorIndex);
	for (const key of keys) runKey(state, key);
	return state;
}
