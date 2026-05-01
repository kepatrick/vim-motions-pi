import { describe, expect, it } from "vitest";

import {
	expandParagraphObject,
	expandWordObject,
	findCharInLine,
	nextWordStart,
	normalizeClipboardMode,
	prevWordStart,
	textToIndex,
	indexToCursor,
	wordEnd,
} from "./core";

describe("normalizeClipboardMode", () => {
	it("normalizes supported values", () => {
		expect(normalizeClipboardMode(undefined)).toBe("off");
		expect(normalizeClipboardMode("off")).toBe("off");
		expect(normalizeClipboardMode("true")).toBe("all");
		expect(normalizeClipboardMode("yank-only")).toBe("yank");
	});
});

describe("cursor/index conversion", () => {
	it("converts between text index and cursor", () => {
		const text = "abc\ndefg\nhi";
		const index = textToIndex(text, { line: 1, col: 2 });
		expect(index).toBe(6);
		expect(indexToCursor(text, index)).toEqual({ line: 1, col: 2 });
	});
});

describe("word motions", () => {
	it("moves to next and previous word starts", () => {
		const text = "one, two three";
		expect(nextWordStart(text, 0, 1)).toBe(3);
		expect(nextWordStart(text, 3, 1)).toBe(5);
		expect(prevWordStart(text, 8, 1)).toBe(5);
	});

	it("supports counts and whitespace/punctuation boundaries", () => {
		const text = "  one,  two... three";
		expect(nextWordStart(text, 0, 1)).toBe(2);
		expect(nextWordStart(text, 2, 3)).toBe(11);
		expect(prevWordStart(text, 14, 2)).toBe(8);
	});

	it("finds word end", () => {
		expect(wordEnd("one two", 0, 1)).toBe(2);
		expect(wordEnd("one two", 3, 1)).toBe(6);
	});

	it("finds word end across spaces and punctuation with counts", () => {
		expect(wordEnd("  one... two", 0, 1)).toBe(4);
		expect(wordEnd("one two three", 0, 2)).toBe(6);
		expect(wordEnd("one ... two", 3, 1)).toBe(6);
	});
});

describe("findCharInLine", () => {
	it("supports f/F/t/T semantics", () => {
		const text = "abc def ghi";
		expect(findCharInLine(text, 0, "f", "d", 1)).toBe(4);
		expect(findCharInLine(text, 0, "t", "d", 1)).toBe(3);
		expect(findCharInLine(text, 8, "F", "d", 1)).toBe(4);
		expect(findCharInLine(text, 8, "T", "d", 1)).toBe(5);
	});
});

describe("text objects", () => {
	it("expands inner and around word", () => {
		const text = "  hello world";
		expect(expandWordObject(text, 3, false, false)).toEqual({ start: 2, end: 7, linewise: false });
		expect(expandWordObject(text, 3, true, false)).toEqual({ start: 0, end: 8, linewise: false });
	});

	it("handles whitespace and punctuation word objects", () => {
		const text = "foo,  bar baz";
		expect(expandWordObject(text, 4, false, false)).toEqual({ start: 4, end: 6, linewise: false });
		expect(expandWordObject(text, 3, false, false)).toEqual({ start: 0, end: 0, linewise: false });
		expect(expandWordObject(text, 3, true, false)).toEqual({ start: 3, end: 6, linewise: false });
	});

	it("handles big word objects", () => {
		const text = "foo.bar baz";
		expect(expandWordObject(text, 1, false, true)).toEqual({ start: 0, end: 7, linewise: false });
		expect(expandWordObject(text, 1, true, true)).toEqual({ start: 0, end: 8, linewise: false });
	});

	it("expands paragraph", () => {
		const text = "one\ntwo\n\nthree\nfour\n";
		expect(expandParagraphObject(text, 1)).toEqual({ start: 0, end: 8, linewise: true });
		expect(expandParagraphObject(text, 10)).toEqual({ start: 9, end: text.length, linewise: true });
	});

	it("handles leading and trailing paragraphs", () => {
		const text = "alpha\n\nbeta\ngamma";
		expect(expandParagraphObject(text, 1)).toEqual({ start: 0, end: 6, linewise: true });
		expect(expandParagraphObject(text, 8)).toEqual({ start: 7, end: text.length, linewise: true });
	});
});
