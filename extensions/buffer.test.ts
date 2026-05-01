import { describe, expect, it } from "vitest";

import { VimBuffer } from "./buffer";

describe("VimBuffer", () => {
	it("deletes by motion and updates register", () => {
		const buffer = new VimBuffer("hello world", 0);
		buffer.deleteMotion("w", 1);
		expect(buffer.text).toBe("world");
		expect(buffer.cursorIndex).toBe(0);
		expect(buffer.register).toEqual({ text: "hello ", linewise: false });
	});

	it("supports d$-style deletion", () => {
		const buffer = new VimBuffer("one two three", 4);
		buffer.deleteMotion("$", 1);
		expect(buffer.text).toBe("one ");
		expect(buffer.cursorIndex).toBe(4);
		expect(buffer.register).toEqual({ text: "two three", linewise: false });
	});

	it("supports x and X style deletion", () => {
		const forward = new VimBuffer("abcd", 1);
		forward.deleteCurrentChar(1);
		expect(forward.text).toBe("acd");
		expect(forward.register).toEqual({ text: "b", linewise: false });

		const backward = new VimBuffer("abcd", 2);
		backward.deleteBackwardChar(1);
		expect(backward.text).toBe("acd");
		expect(backward.cursorIndex).toBe(1);
		expect(backward.register).toEqual({ text: "b", linewise: false });
	});

	it("yanks a line and pastes it below", () => {
		const buffer = new VimBuffer("one\ntwo", 0);
		buffer.yankLine(1);
		buffer.applyRegister(false);
		expect(buffer.text).toBe("one\none\ntwo");
		expect(buffer.register).toEqual({ text: "one\n", linewise: true });
	});

	it("supports charwise paste after cursor", () => {
		const buffer = new VimBuffer("hello world", 0);
		buffer.deleteMotion("w", 1);
		buffer.cursorIndex = 4;
		buffer.applyRegister(false);
		expect(buffer.text).toBe("worldhello ");
	});

	it("applies inner word text object ranges", () => {
		const buffer = new VimBuffer("foo bar baz", 5);
		const range = buffer.textObjectRange("i", "w");
		expect(range).toEqual({ start: 4, end: 7, linewise: false });
		buffer.applyRange(range!);
		expect(buffer.text).toBe("foo  baz");
		expect(buffer.register).toEqual({ text: "bar", linewise: false });
	});

	it("resolves visual-line selection range", () => {
		const buffer = new VimBuffer("one\ntwo\nthree", 8);
		expect(buffer.getVisualRange("visual-line", 0)).toEqual({ start: 0, end: 13, linewise: true });
	});

	it("handles multiline linewise paste before and after", () => {
		const after = new VimBuffer("one\ntwo", 0, { text: "alpha\nbeta\n", linewise: true });
		after.applyRegister(false);
		expect(after.text).toBe("one\nalpha\nbeta\ntwo");

		const before = new VimBuffer("one\ntwo", 4, { text: "alpha\nbeta\n", linewise: true });
		before.applyRegister(true);
		expect(before.text).toBe("one\nalpha\nbeta\ntwo");
	});
});
