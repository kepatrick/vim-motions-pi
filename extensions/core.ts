export type ClipboardMode = "off" | "all" | "yank";
export type FindKind = "f" | "F" | "t" | "T";
export type Cursor = { line: number; col: number };
export type Range = { start: number; end: number; linewise: boolean };

export function normalizeClipboardMode(raw: string | undefined): ClipboardMode {
	const value = (raw ?? "").trim().toLowerCase();
	if (value === "" || value === "0" || value === "false" || value === "off") return "off";
	if (value === "yank" || value === "yank-only" || value === "only") return "yank";
	if (value === "1" || value === "true" || value === "yes" || value === "on" || value === "all") return "all";
	return "off";
}

export function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

export function splitLines(text: string): string[] {
	return text.split("\n");
}

export function textToIndex(text: string, cursor: Cursor): number {
	const lines = splitLines(text);
	let index = 0;
	for (let i = 0; i < cursor.line; i++) index += (lines[i]?.length ?? 0) + 1;
	return index + cursor.col;
}

export function indexToCursor(text: string, index: number): Cursor {
	const safe = clamp(index, 0, text.length);
	const before = text.slice(0, safe).split("\n");
	return { line: before.length - 1, col: before[before.length - 1]?.length ?? 0 };
}

export function lineBounds(text: string, index: number): { start: number; end: number; line: string; lineIndex: number } {
	const safe = clamp(index, 0, text.length);
	const start = text.lastIndexOf("\n", Math.max(0, safe - 1));
	const lineStart = start === -1 ? 0 : start + 1;
	const endNl = text.indexOf("\n", safe);
	const lineEnd = endNl === -1 ? text.length : endNl;
	const lineIndex = text.slice(0, lineStart).split("\n").length - 1;
	return { start: lineStart, end: lineEnd, line: text.slice(lineStart, lineEnd), lineIndex };
}

export function isWordChar(ch: string): boolean {
	return /[A-Za-z0-9_]/.test(ch);
}

export function isSpaceChar(ch: string): boolean {
	return /\s/.test(ch);
}

export function isPunctChar(ch: string): boolean {
	return ch !== "" && !isSpaceChar(ch) && !isWordChar(ch);
}

export function lineStartIndex(text: string, index: number): number {
	return lineBounds(text, index).start;
}

export function lineEndCharIndex(text: string, index: number): number {
	const bounds = lineBounds(text, index);
	return Math.max(bounds.start, bounds.end - 1);
}

export function firstNonBlankIndex(text: string, index: number): number {
	const bounds = lineBounds(text, index);
	for (let i = 0; i < bounds.line.length; i++) {
		if (!/[ \t]/.test(bounds.line[i]!)) return bounds.start + i;
	}
	return bounds.end;
}

export function moveLeftIndex(index: number, count: number): number {
	return Math.max(0, index - count);
}

export function moveRightIndex(text: string, index: number, count: number): number {
	return Math.min(text.length, index + count);
}

export function nextWordStart(text: string, index: number, count: number): number {
	let i = clamp(index, 0, text.length);
	for (let n = 0; n < count; n++) {
		if (i >= text.length) return text.length;
		const kind = isSpaceChar(text[i]!) ? "space" : isWordChar(text[i]!) ? "word" : "punct";
		if (kind === "space") {
			while (i < text.length && isSpaceChar(text[i]!)) i++;
		} else if (kind === "word") {
			while (i < text.length && isWordChar(text[i]!)) i++;
		} else {
			while (i < text.length && isPunctChar(text[i]!)) i++;
		}
		while (i < text.length && isSpaceChar(text[i]!)) i++;
	}
	return i;
}

export function prevWordStart(text: string, index: number, count: number): number {
	let i = clamp(index, 0, text.length);
	for (let n = 0; n < count; n++) {
		if (i <= 0) return 0;
		i--;
		while (i > 0 && isSpaceChar(text[i]!)) i--;
		if (isPunctChar(text[i]!)) {
			while (i > 0 && isPunctChar(text[i - 1]!)) i--;
		} else {
			while (i > 0 && isWordChar(text[i - 1]!)) i--;
		}
	}
	return i;
}

export function wordEnd(text: string, index: number, count: number): number {
	let i = clamp(index, 0, text.length);
	for (let n = 0; n < count; n++) {
		if (i >= text.length) return text.length;
		while (i < text.length && isSpaceChar(text[i]!)) i++;
		if (i >= text.length) return text.length;
		const tokenIsWord = isWordChar(text[i]!);
		let end = i;
		while (end < text.length && (tokenIsWord ? isWordChar(text[end]!) : isPunctChar(text[end]!))) end++;
		const tokenEnd = Math.max(i, end - 1);
		if (i < tokenEnd) {
			i = tokenEnd;
			continue;
		}
		let next = end;
		while (next < text.length && isSpaceChar(text[next]!)) next++;
		if (next >= text.length) return tokenEnd;
		const nextIsWord = isWordChar(text[next]!);
		end = next;
		while (end < text.length && (nextIsWord ? isWordChar(text[end]!) : isPunctChar(text[end]!))) end++;
		i = Math.max(next, end - 1);
	}
	return Math.max(0, Math.min(text.length, i));
}

export function findCharInLine(text: string, index: number, kind: FindKind, ch: string, count: number): number {
	const bounds = lineBounds(text, index);
	const line = bounds.line;
	const col = index - bounds.start;
	let target = -1;
	let from = col;

	for (let n = 0; n < count; n++) {
		if (kind === "f" || kind === "t") {
			target = line.indexOf(ch, from + 1);
			if (target === -1) return index;
			from = target;
		} else {
			target = line.lastIndexOf(ch, from - 1);
			if (target === -1) return index;
			from = target;
		}
	}

	if (kind === "f") return bounds.start + target;
	if (kind === "F") return bounds.start + target;
	if (kind === "t") return bounds.start + Math.max(0, target - 1);
	return bounds.start + Math.min(line.length - 1, target + 1);
}

export function normalizeText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
}

function isEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
	return backslashes % 2 === 1;
}

export function expandWordObject(text: string, index: number, around: boolean, bigWord: boolean): Range {
	const bounds = lineBounds(text, index);
	const probe = clamp(index, bounds.start, Math.max(bounds.start, bounds.end - 1));
	const probeChar = text[probe] ?? "";
	const prevChar = probe > bounds.start ? text[probe - 1] ?? "" : "";
	const nextChar = probe < bounds.end ? text[probe + 1] ?? "" : "";
	const classAt = (ch: string): "blank" | "word" | "punct" | "none" => {
		if (!ch) return "none";
		if (isSpaceChar(ch)) return "blank";
		if (bigWord) return "word";
		return isWordChar(ch) ? "word" : "punct";
	};
	const tokenClass = classAt(probeChar) !== "none" ? classAt(probeChar) : classAt(prevChar);
	if (tokenClass === "none") return { start: bounds.start, end: bounds.start, linewise: false };

	const inToken = (ch: string): boolean => classAt(ch) === tokenClass;
	let start = probe;
	let end = probe + 1;

	while (start > bounds.start && inToken(text[start - 1]!)) start--;
	while (end < bounds.end && inToken(text[end]!)) end++;

	if (tokenClass === "blank") {
		if (around) {
			while (end < bounds.end && isSpaceChar(text[end]!)) end++;
			while (end < bounds.end && !isSpaceChar(text[end]!)) {
				if (bigWord) {
					while (end < bounds.end && !isSpaceChar(text[end]!)) end++;
					break;
				}
				if (isWordChar(text[end]!)) {
					while (end < bounds.end && isWordChar(text[end]!)) end++;
				} else {
					while (end < bounds.end && !isSpaceChar(text[end]!) && !isWordChar(text[end]!)) end++;
				}
				break;
			}
		}
		return { start, end, linewise: false };
	}

	if (tokenClass === "punct" && !around) {
		if (prevChar && isWordChar(prevChar) && isSpaceChar(nextChar)) {
			return { start: bounds.start, end: bounds.start, linewise: false };
		}
	}

	if (around && tokenClass === "word") {
		while (start > bounds.start && isSpaceChar(text[start - 1]!)) start--;
		while (end < bounds.end && isSpaceChar(text[end]!)) end++;
	}

	if (around && tokenClass === "punct") {
		while (end < bounds.end && isSpaceChar(text[end]!)) end++;
	}

	return { start, end, linewise: false };
}

export function expandDelimitedObject(text: string, index: number, around: boolean, delimiter: "\"" | "'"): Range | null {
	const bounds = lineBounds(text, index);
	const positions: number[] = [];
	for (let i = bounds.start; i < bounds.end; i++) {
		if (text[i] === delimiter && !isEscaped(text, i)) positions.push(i);
	}
	if (positions.length < 2) return null;

	const cursor = clamp(index, bounds.start, bounds.end);
	for (let i = 0; i + 1 < positions.length; i += 2) {
		const open = positions[i]!;
		const close = positions[i + 1]!;
		if (cursor >= open && cursor <= close) {
			if (around) return { start: open, end: close + 1, linewise: false };
			return { start: open + 1, end: close, linewise: false };
		}
	}
	return null;
}

export function expandParagraphObject(text: string, index: number): Range {
	const lines = splitLines(text);
	const cursor = indexToCursor(text, index);
	let startLine = cursor.line;
	let endLine = cursor.line;
	while (startLine > 0 && (lines[startLine - 1] ?? "").trim() !== "") startLine--;
	while (endLine < lines.length - 1 && (lines[endLine + 1] ?? "").trim() !== "") endLine++;
	let start = 0;
	for (let i = 0; i < startLine; i++) start += (lines[i]?.length ?? 0) + 1;
	let end = 0;
	for (let i = 0; i <= endLine; i++) end += (lines[i]?.length ?? 0) + 1;
	if (end > text.length) end = text.length;
	return { start, end, linewise: true };
}
