import { describe, expect, it, vi } from "vitest";

import { clipboardAttemptsForPlatform, tryClipboardWrite } from "./clipboard";

describe("clipboardAttemptsForPlatform", () => {
	it("returns platform-specific command order", () => {
		expect(clipboardAttemptsForPlatform("darwin")).toEqual([{ command: "pbcopy", args: [] }]);
		expect(clipboardAttemptsForPlatform("win32")).toEqual([
			{ command: "clip", args: [] },
			{ command: "powershell", args: ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"] },
		]);
		expect(clipboardAttemptsForPlatform("linux")).toEqual([
			{ command: "wl-copy", args: [] },
			{ command: "xclip", args: ["-selection", "clipboard"] },
			{ command: "xsel", args: ["--clipboard", "--input"] },
		]);
	});
});

describe("tryClipboardWrite", () => {
	it("stops after first successful command", () => {
		const run = vi.fn()
			.mockReturnValueOnce({ status: 1 })
			.mockReturnValueOnce({ status: 0 })
			.mockReturnValueOnce({ status: 0 });
		const ok = tryClipboardWrite("hello", "linux", run);
		expect(ok).toBe(true);
		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[0]).toEqual(["wl-copy", [], "hello"]);
		expect(run.mock.calls[1]).toEqual(["xclip", ["-selection", "clipboard"], "hello"]);
	});

	it("continues past errors and returns false when all fail", () => {
		const run = vi.fn()
			.mockReturnValueOnce({ error: new Error("missing"), status: null })
			.mockReturnValueOnce({ status: 1 })
			.mockReturnValueOnce({ status: 1 });
		const ok = tryClipboardWrite("hello", "linux", run);
		expect(ok).toBe(false);
		expect(run).toHaveBeenCalledTimes(3);
	});

	it("does not invoke runner for empty text", () => {
		const run = vi.fn();
		expect(tryClipboardWrite("", "darwin", run)).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});
});
