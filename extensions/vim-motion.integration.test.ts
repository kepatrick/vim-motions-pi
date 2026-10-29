import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@mariozechner/pi-coding-agent", () => ({
	CustomEditor: class {
		private text = "";
		state = { cursorLine: 0, cursorCol: 0, lines: [""] };
		tui: any;
		focused = false;
		autocompleteState: unknown;
		scrollOffset = 0;
		lastWidth = 0;
		constructor(tui?: unknown, ..._args: unknown[]) {
			this.tui = tui ?? { requestRender: () => {}, terminal: { rows: 24 } };
		}
		inserted: string[] = [];
		handleInput(data: string): void { this.inserted.push(data); }
		rendered: string[] = [];
		render(_width: number): string[] { return this.rendered; }
		buildVisualLineMap(): Array<{ logicalLine: number; startCol: number; length: number }> {
			return this.state.lines.map((line, logicalLine) => ({ logicalLine, startCol: 0, length: line.length }));
		}
		getText(): string { return this.text; }
		getCursor(): { line: number; col: number } { return { line: this.state.cursorLine, col: this.state.cursorCol }; }
		setText(text: string): void {
			this.text = text;
			this.state.lines = text.split("\n");
		}
		getLines(): string[] { return this.state.lines; }
		getPaddingX(): number { return 0; }
		borderColor(text: string): string { return text; }
	},
}));

type RegisteredCommand = { description: string; handler: (...args: any[]) => Promise<void> | void };
type RegisteredHandlers = Record<string, Array<(...args: any[]) => unknown>>;

async function loadExtension() {
	const commands = new Map<string, RegisteredCommand>();
	const handlers: RegisteredHandlers = {};
	const pi = {
		registerCommand: vi.fn((name: string, options: RegisteredCommand) => {
			commands.set(name, options);
		}),
		on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
			(handlers[event] ??= []).push(handler);
		}),
	};

	const mod = await import("./vim-motion");
	mod.default(pi as any);
	return { pi, commands, handlers };
}

async function createEditorInstance() {
	const { handlers } = await loadExtension();
	const setEditorComponent = vi.fn();
	const notify = vi.fn();
	const ctx = { ui: { setEditorComponent, notify } };
	await handlers.session_start?.[0]?.({}, ctx);
	const factory = setEditorComponent.mock.calls[0]?.[0];
	const tui = {
		requestRender: vi.fn(), terminal: { rows: 24, write: vi.fn() },
		getShowHardwareCursor: vi.fn().mockReturnValue(false), setShowHardwareCursor: vi.fn(),
	};
	return { editor: factory?.(tui, {}, {}), notify, tui, handlers };
}

describe("vim-motion integration", () => {
	let configDir: string;
	afterEach(() => {
		rmSync(configDir, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});
	beforeEach(() => {
		configDir = mkdtempSync(join(tmpdir(), "vim-settings-integration-"));
		vi.stubEnv("PI_CODING_AGENT_DIR", configDir);
		vi.resetModules();
		delete process.env.VIM_MOTION_PI_CLIPBOARD;
		delete process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE;
		delete process.env.VIM_MOTION_PI_ESCAPE_TIMEOUT_MS;
	});

	it("changes settings through the menu, persists them, and reloads them", async () => {
		const { commands } = await loadExtension();
		const select = vi.fn()
			.mockImplementationOnce((_title, rows) => rows[0])
			.mockImplementationOnce((_title, rows) => rows[6])
			.mockResolvedValueOnce("Yank only")
			.mockResolvedValueOnce(undefined);
		const ui = { select, input: vi.fn().mockResolvedValue("jj"), notify: vi.fn() };
		await commands.get("vim-settings")?.handler("", { ui });
		const saved = JSON.parse(readFileSync(join(configDir, "vim-motions.json"), "utf8"));
		expect(saved).toEqual({ escapeSequence: "jj", clipboard: "yank" });
		vi.resetModules();
		const { editor, notify } = await createEditorInstance();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("yank only"), "info");
		editor.handleInput("j");
		editor.handleInput("j");
		expect((editor as any).mode).toBe("normal");
	});

	it.each([
		["insert", "insertCursor"], ["normal", "normalCursor"],
		["visual", "visualCursor"], ["visual-line", "visualLineCursor"],
	])("uses the real bar cursor when rendering %s mode", async (mode, key) => {
		const { saveSettings } = await import("./settings");
		saveSettings({ [key]: "bar" });
		const { editor, tui, handlers } = await createEditorInstance();
		const { CURSOR_MARKER } = await import("@mariozechner/pi-tui");
		editor.focused = true;
		editor.mode = mode;
		editor.rendered = [`${CURSOR_MARKER}\x1b_pi:fc\x07 \x1b_pi:/fc\x07`, "─".repeat(30)];
		const lines = editor.render(30).join("\n");
		expect(lines).toContain(`${CURSOR_MARKER} `);
		expect(lines).not.toContain("▏");
		expect(tui.setShowHardwareCursor).toHaveBeenCalledWith(true);
		expect(tui.terminal.write).toHaveBeenCalledWith("\x1b[6 q");
		await handlers.session_shutdown?.[0]?.({}, {});
		expect(tui.setShowHardwareCursor).toHaveBeenLastCalledWith(false);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[0 q");
	});

	it("keeps the bar shape over text and restores it around dialogs", async () => {
		const { editor, tui } = await createEditorInstance();
		const { CURSOR_MARKER } = await import("@mariozechner/pi-tui");
		editor.focused = true;
		editor.rendered = [`a${CURSOR_MARKER}\x1b_pi:fc\x07中\x1b_pi:/fc\x07c`, "─".repeat(30)];
		expect(editor.render(30)[0]).toBe(`a${CURSOR_MARKER}中c`);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[6 q");
		editor.focused = false;
		editor.render(30);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[0 q");
		expect(tui.setShowHardwareCursor).toHaveBeenLastCalledWith(false);
		editor.focused = true;
		editor.render(30);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[6 q");
		editor.handleInput("\x1b");
		editor.render(30);
		expect(tui.terminal.write).toHaveBeenLastCalledWith("\x1b[2 q");
	});

	it("clears a pending escape prefix when settings change", async () => {
		process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
		const { commands, handlers } = await loadExtension();
		const setEditorComponent = vi.fn();
		await handlers.session_start?.[0]?.({}, { ui: { setEditorComponent, notify: vi.fn() } });
		const editor = setEditorComponent.mock.calls[0][0]({}, {}, {});
		editor.handleInput("j");
		await commands.get("vim-clipboard")?.handler("", { ui: { select: vi.fn().mockResolvedValue("Off"), notify: vi.fn() } });
		editor.handleInput("k");
		expect(editor.mode).toBe("insert");
		expect(editor.inserted).toEqual(["j", "k"]);
	});

	it("registers the command and session_start handler", async () => {
		const { commands, handlers } = await loadExtension();
		expect(commands.has("vim-clipboard")).toBe(true);
		expect(handlers.session_start).toHaveLength(1);
	});

	it("wires session_start editor factory and startup notification", async () => {
		const { handlers } = await loadExtension();
		const setEditorComponent = vi.fn();
		const notify = vi.fn();
		const ctx = { ui: { setEditorComponent, notify } };

		await handlers.session_start?.[0]?.({}, ctx);

		expect(setEditorComponent).toHaveBeenCalledTimes(1);
		const factory = setEditorComponent.mock.calls[0]?.[0];
		expect(typeof factory).toBe("function");
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Clipboard sync: off"), "info");

		const editor = factory?.({}, {}, {});
		expect(editor).toBeTruthy();
	});

	it("updates clipboard mode through /vim-clipboard", async () => {
		const { commands } = await loadExtension();
		const command = commands.get("vim-clipboard");
		const notify = vi.fn();
		const ui = { select: vi.fn(), notify };

		ui.select.mockResolvedValueOnce("All operations");
		await command?.handler([], { ui } as any);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("all operations"), "info");

		ui.select.mockResolvedValueOnce("Yank only");
		await command?.handler([], { ui } as any);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("yank only"), "info");

		ui.select.mockResolvedValueOnce("Off");
		await command?.handler([], { ui } as any);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("off"), "info");
	});

	it("does nothing when clipboard selection is cancelled", async () => {
		const { commands } = await loadExtension();
		const command = commands.get("vim-clipboard");
		const notify = vi.fn();
		const ui = { select: vi.fn().mockResolvedValue(undefined), notify };

		await command?.handler([], { ui } as any);
		expect(notify).not.toHaveBeenCalled();
	});

	it("reads startup clipboard mode from env", async () => {
		process.env.VIM_MOTION_PI_CLIPBOARD = "yank";
		const { handlers } = await loadExtension();
		const setEditorComponent = vi.fn();
		const notify = vi.fn();
		const ctx = { ui: { setEditorComponent, notify } };

		await handlers.session_start?.[0]?.({}, ctx);

		expect(notify).toHaveBeenCalledWith(expect.stringContaining("yank only"), "info");
	});

	it("handles a normal-mode delete motion through the real editor", async () => {
		const { editor } = await createEditorInstance();
		editor.setText("hello world");
		editor.handleInput("\x1b");
		editor.handleInput("d");
		editor.handleInput("w");
		expect(editor.getText()).toBe("world");
	});

	it("handles a visual delete through the real editor", async () => {
		const { editor } = await createEditorInstance();
		editor.setText("hello world");
		editor.handleInput("\x1b");
		editor.handleInput("v");
		editor.handleInput("w");
		editor.handleInput("d");
		expect(editor.getText()).toBe("orld");
	});

	it.each([
		{ name: "single character", text: "abc", keys: "v", remaining: "bc", deleted: "a", linewise: false },
		{ name: "forward selection", text: "hello world", keys: "vw", remaining: "orld", deleted: "hello w", linewise: false },
		{ name: "backward selection", text: "abcde", keys: "llvhh", remaining: "de", deleted: "abc", linewise: false },
		{ name: "whole line", text: "one\ntwo\nthree", keys: "V", remaining: "two\nthree", deleted: "one\n", linewise: true },
		{ name: "multiple whole lines", text: "one\ntwo\nthree", keys: "Vw", remaining: "three", deleted: "one\ntwo\n", linewise: true },
		{ name: "text object", text: "hello world", keys: "viw", remaining: " world", deleted: "hello", linewise: false },
		{ name: "entire buffer", text: "abc", keys: "v$", remaining: "", deleted: "abc", linewise: false },
		{ name: "empty buffer", text: "", keys: "v", remaining: "", deleted: "", linewise: false },
	])("deletes $name with visual x", async ({ text, keys, remaining, deleted, linewise }) => {
		const { editor } = await createEditorInstance();
		editor.setText(text);
		editor.handleInput("\x1b");
		for (const key of keys) editor.handleInput(key);

		editor.handleInput("x");

		expect(editor.getText()).toBe(remaining);
		expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
		expect(editor.mode).toBe("normal");
		expect(editor.getSelectionRange()).toBeNull();
		expect(editor.register).toEqual({ text: deleted, linewise });
	});

	it("handles quoted text objects through the real editor", async () => {
		const { editor } = await createEditorInstance();
		editor.setText('say "hello world" end');
		editor.handleInput("\x1b");
		editor.handleInput("l");
		editor.handleInput("l");
		editor.handleInput("l");
		editor.handleInput("l");
		editor.handleInput("l");
		editor.handleInput("c");
		editor.handleInput("i");
		editor.handleInput('"');
		expect(editor.getText()).toBe('say "" end');
		expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
	});

	describe("escape sequence window", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(1000);
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it.each(["'/", "//", "''", "jj"])("accepts symbol and repeated-character sequence %s", async (sequence) => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = sequence;
			const { editor } = await createEditorInstance();
			editor.handleInput(sequence[0]);
			vi.advanceTimersByTime(50);
			editor.handleInput(sequence[1]);
			expect(editor.mode).toBe("normal");
			expect(editor.inserted).toEqual([sequence[0], "\x7f"]);
		});

		it.each([
			["\x1b[39u", "\x1b[47u"],
			["\x1b[27;1;39~", "\x1b[27;1;47~"],
		])("matches encoded apostrophe/slash keys %j %j", async (first, second) => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "'/";
			const { editor } = await createEditorInstance();
			editor.handleInput(first);
			vi.advanceTimersByTime(50);
			editor.handleInput(second);
			expect(editor.mode).toBe("normal");
			expect(editor.inserted).toEqual([first, "\x7f"]);
		});

		it("does not let key releases cancel a pending prefix", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "'/";
			const { editor } = await createEditorInstance();
			editor.handleInput("\x1b[39;1:1u");
			editor.handleInput("\x1b[39;1:3u");
			editor.handleInput("\x1b[47;1:1u");
			expect(editor.mode).toBe("normal");
		});

		it("inserts the prefix instantly and escapes when the sequence completes inside the window", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
			process.env.VIM_MOTION_PI_ESCAPE_TIMEOUT_MS = "100";
			const { editor } = await createEditorInstance();
			editor.handleInput("j");
			expect(editor.inserted).toEqual(["j"]);
			editor.handleInput("k");
			expect((editor as any).mode).toBe("normal");
			// j is deleted via backspace, k is never inserted
			expect(editor.inserted).toEqual(["j", "\x7f"]);
		});

		it("types a literal jk when the second key lands after the window", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
			process.env.VIM_MOTION_PI_ESCAPE_TIMEOUT_MS = "100";
			const { editor } = await createEditorInstance();
			editor.handleInput("j");
			vi.advanceTimersByTime(150);
			editor.handleInput("k");
			expect((editor as any).mode).toBe("insert");
			expect(editor.inserted).toEqual(["j", "k"]);
		});

		it("keeps the prefix when a non-matching key follows", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
			const { editor } = await createEditorInstance();
			editor.handleInput("j");
			editor.handleInput("x");
			expect((editor as any).mode).toBe("insert");
			expect(editor.inserted).toEqual(["j", "x"]);
		});

		it("restarts the prefix when the first key repeats", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
			const { editor } = await createEditorInstance();
			editor.handleInput("j");
			editor.handleInput("j");
			editor.handleInput("k");
			expect((editor as any).mode).toBe("normal");
			// first j stays, second j is deleted via backspace, k never inserted
			expect(editor.inserted).toEqual(["j", "j", "\x7f"]);
		});

		it("clears a pending prefix when a real escape key is pressed", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
			const { editor } = await createEditorInstance();
			editor.handleInput("j");
			editor.handleInput("\x1b");
			expect((editor as any).mode).toBe("normal");
			expect(editor.inserted).toEqual(["j"]);
			editor.handleInput("i");
			editor.handleInput("k");
			expect((editor as any).mode).toBe("insert");
			expect(editor.inserted).toEqual(["j", "k"]);
		});

		it.each(["\x1b[D", "\x7f", "\b", "\r", "\t", "\x03", "pasted text", "\x1b[200~paste\x1b[201~"])(
			"cancels a pending prefix on intervening input %j", async (input) => {
				process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
				const { editor } = await createEditorInstance();
				editor.handleInput("j");
				editor.handleInput(input);
				editor.handleInput("k");
				expect((editor as any).mode).toBe("insert");
				expect(editor.inserted).toEqual(["j", input, "k"]);
				// A new uninterrupted sequence should still work.
				editor.handleInput("j");
				editor.handleInput("k");
				expect((editor as any).mode).toBe("normal");
				expect(editor.inserted).toEqual(["j", input, "k", "j", "\x7f"]);
			},
		);

		it("passes multi-char input through without matching", async () => {
			process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE = "jk";
			const { editor } = await createEditorInstance();
			editor.handleInput("hjk");
			expect((editor as any).mode).toBe("insert");
			expect(editor.inserted).toEqual(["hjk"]);
		});
	});
});
