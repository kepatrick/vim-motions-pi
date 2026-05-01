import { describe, expect, it } from "vitest";

import { runKeys } from "./harness";

describe("key harness", () => {
	it("supports dw", () => {
		const state = runKeys("hello world", ["escape", "d", "w"]);
		expect(state.text).toBe("world");
		expect(state.mode).toBe("normal");
		expect(state.register).toEqual({ text: "hello ", linewise: false });
	});

	it("supports d$, db, and de", () => {
		expect(runKeys("one two three", ["escape", "d", "$"], 4).text).toBe("one ");
		expect(runKeys("one two three", ["escape", "d", "b"], 8).text).toBe("one three");
		expect(runKeys("one two three", ["escape", "d", "e"], 4).text).toBe("one  three");
	});

	it("supports ciw and diw", () => {
		const change = runKeys("hello world", ["escape", "c", "i", "w"]);
		expect(change.text).toBe(" world");
		expect(change.mode).toBe("insert");
		expect(change.register).toEqual({ text: "hello", linewise: false });

		const del = runKeys("say hello world", ["escape", "d", "i", "w"], 5);
		expect(del.text).toBe("say  world");
		expect(del.mode).toBe("normal");
		expect(del.register).toEqual({ text: "hello", linewise: false });
	});

	it("supports cw with motion", () => {
		const state = runKeys("hello world", ["escape", "c", "w"]);
		expect(state.text).toBe("world");
		expect(state.mode).toBe("insert");
		expect(state.register).toEqual({ text: "hello ", linewise: false });
	});

	it("supports yyp and P", () => {
		const linewise = runKeys("one\ntwo", ["escape", "y", "y", "p"]);
		expect(linewise.text).toBe("one\none\ntwo");
		expect(linewise.register).toEqual({ text: "one\n", linewise: true });

		const charwise = runKeys("hello world", ["escape", "d", "w", "P"], 0);
		expect(charwise.text).toBe("hello world");
	});

	it("supports x and X", () => {
		expect(runKeys("abcd", ["escape", "x"], 1).text).toBe("acd");
		expect(runKeys("abcd", ["escape", "X"], 2).text).toBe("acd");
	});

	it("supports counts", () => {
		const state = runKeys("one two three four", ["escape", "2", "d", "w"]);
		expect(state.text).toBe("three four");
		expect(state.register).toEqual({ text: "one two ", linewise: false });
	});

	it("supports line operators", () => {
		const dd = runKeys("one\ntwo\nthree", ["escape", "d", "d"]);
		expect(dd.text).toBe("two\nthree");
		expect(dd.register).toEqual({ text: "one\n", linewise: true });

		const yy = runKeys("one\ntwo", ["escape", "y", "y", "p"]);
		expect(yy.text).toBe("one\none\ntwo");

		const cc = runKeys("one\ntwo", ["escape", "c", "c"]);
		expect(cc.text).toBe("two");
		expect(cc.mode).toBe("insert");
	});

	it("supports counted line operators", () => {
		const dd = runKeys("one\ntwo\nthree\nfour", ["escape", "2", "d", "d"]);
		expect(dd.text).toBe("three\nfour");
		expect(dd.register).toEqual({ text: "one\ntwo\n", linewise: true });

		const yy = runKeys("one\ntwo\nthree", ["escape", "2", "y", "y", "p"]);
		expect(yy.text).toBe("one\none\ntwo\ntwo\nthree");

		const cc = runKeys("one\ntwo\nthree", ["escape", "2", "c", "c"]);
		expect(cc.text).toBe("three");
		expect(cc.mode).toBe("insert");
	});

	it("supports replace and line open helpers", () => {
		const replace = runKeys("cat", ["escape", "r", "b"]);
		expect(replace.text).toBe("bat");

		const below = runKeys("one", ["escape", "o"]);
		expect(below.text).toBe("one\n");
		expect(below.mode).toBe("insert");

		const above = runKeys("one", ["escape", "O"]);
		expect(above.text).toBe("\none");
		expect(above.mode).toBe("insert");
	});

	it("supports join lines", () => {
		const state = runKeys("one\ntwo\nthree", ["escape", "J"]);
		expect(state.text).toBe("one two\nthree");
	});

	it("supports visual and visual-line operators", () => {
		const visualDelete = runKeys("hello world", ["escape", "v", "w", "d"]);
		expect(visualDelete.text).toBe("orld");
		expect(visualDelete.register).toEqual({ text: "hello w", linewise: false });

		const visualYank = runKeys("hello world", ["escape", "v", "w", "y"]);
		expect(visualYank.text).toBe("hello world");
		expect(visualYank.register).toEqual({ text: "hello w", linewise: false });

		const visualChange = runKeys("hello world", ["escape", "v", "w", "c"]);
		expect(visualChange.text).toBe("orld");
		expect(visualChange.mode).toBe("insert");

		const visualLineDelete = runKeys("one\ntwo\nthree", ["escape", "V", "d"]);
		expect(visualLineDelete.text).toBe("two\nthree");
		expect(visualLineDelete.register).toEqual({ text: "one\n", linewise: true });

		const visualLineYank = runKeys("one\ntwo", ["escape", "V", "y", "p"]);
		expect(visualLineYank.text).toBe("one\none\ntwo");

		const visualLineChange = runKeys("one\ntwo", ["escape", "V", "c"]);
		expect(visualLineChange.text).toBe("two");
		expect(visualLineChange.mode).toBe("insert");
	});

	it("supports visual replace and swap ends", () => {
		const paste = runKeys("alpha beta", ["escape", "d", "w", "v", "w", "p"]);
		expect(paste.text).toBe("alpha ");

		const pasteBefore = runKeys("alpha beta", ["escape", "d", "w", "v", "w", "P"]);
		expect(pasteBefore.text).toBe("alpha ");

		const swapped = runKeys("hello world", ["escape", "v", "w", "o"]);
		expect(swapped.visualAnchor).toBe(6);
		expect(swapped.cursorIndex).toBe(0);
	});

	it("supports gg and G motions", () => {
		const text = "one\ntwo\nthree\nfour";
		expect(runKeys(text, ["escape", "G"]).cursorIndex).toBe(14);
		expect(runKeys(text, ["escape", "g", "g"], 10).cursorIndex).toBe(0);
		expect(runKeys(text, ["escape", "4", "G"]).cursorIndex).toBe(14);
	});

	it("supports counted word motions", () => {
		const state = runKeys("one two three four", ["escape", "3", "w"]);
		expect(state.cursorIndex).toBe(14);
	});

	it("supports visual exit and visual text objects", () => {
		const exited = runKeys("hello world", ["escape", "v", "v"]);
		expect(exited.mode).toBe("normal");

		const visualObjectDelete = runKeys("say hello world", ["escape", "v", "i", "w", "d"], 5);
		expect(visualObjectDelete.text).toBe("say  world");
		expect(visualObjectDelete.register).toEqual({ text: "hello", linewise: false });
	});

	it("supports advanced text objects", () => {
		const daw = runKeys("say hello world", ["escape", "d", "a", "w"], 5);
		expect(daw.text).toBe("sayworld");
		expect(daw.register).toEqual({ text: " hello ", linewise: false });

		const ciW = runKeys("foo.bar baz", ["escape", "c", "i", "W"], 1);
		expect(ciW.text).toBe(" baz");
		expect(ciW.mode).toBe("insert");
		expect(ciW.register).toEqual({ text: "foo.bar", linewise: false });

		const dip = runKeys("one\ntwo\n\nthree\nfour\n", ["escape", "d", "i", "p"], 1);
		expect(dip.text).toBe("\nthree\nfour\n");
		expect(dip.register).toEqual({ text: "one\ntwo\n", linewise: true });

		const dap = runKeys("one\ntwo\n\nthree\nfour\n", ["escape", "d", "a", "p"], 10);
		expect(dap.text).toBe("one\ntwo\n\n");
		expect(dap.register).toEqual({ text: "three\nfour\n", linewise: true });
	});

	it("supports advanced find motions and counts", () => {
		expect(runKeys("a,b,c,d", ["escape", "F", ","], 5).cursorIndex).toBe(3);
		expect(runKeys("a,b,c,d", ["escape", "t", ","], 0).cursorIndex).toBe(0);
		expect(runKeys("a,b,c,d", ["escape", "T", ","], 6).cursorIndex).toBe(6);
		expect(runKeys("a,b,c,d,e", ["escape", "2", "f", ","], 0).cursorIndex).toBe(3);
		expect(runKeys("a,b,c,d,e", ["escape", "2", "f", ",", ";"], 0).cursorIndex).toBe(7);
		expect(runKeys("abc", ["escape", "f", "z"], 1).cursorIndex).toBe(1);
	});

	it("supports find repeat forward and reverse", () => {
		const state = runKeys("a,b,c,d", ["escape", "f", ",", ";", ","]);
		expect(state.cursorIndex).toBe(1);
	});
});
