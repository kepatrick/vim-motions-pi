import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		render(_width: number): string[] { return []; }
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
	return { editor: factory?.({ requestRender: () => {}, terminal: { rows: 24 } }, {}, {}), notify };
}

describe("vim-motion integration", () => {
	beforeEach(() => {
		vi.resetModules();
		delete process.env.VIM_MOTION_PI_CLIPBOARD;
		delete process.env.VIM_MOTION_PI_ESCAPE_SEQUENCE;
		delete process.env.VIM_MOTION_PI_ESCAPE_TIMEOUT_MS;
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

	it("restyles the insert-mode cursor as a width-preserving bar", async () => {
		const { barCursor } = await import("./vim-motion");
		const { CURSOR_MARKER, visibleWidth } = await import("@mariozechner/pi-tui");

		// focused: marker + reverse-video cursor
		const focused = `${CURSOR_MARKER}\x1b[7m \x1b[0mcd`;
		expect(barCursor(focused)).toBe(`${CURSOR_MARKER}▏cd`);
		expect(visibleWidth(barCursor(focused))).toBe(visibleWidth(focused));

		// Without a marker, a reverse-video run may belong to another UI element.
		expect(barCursor("\x1b[7m \x1b[0m")).toBe("\x1b[7m \x1b[0m");

		// no cursor
		expect(barCursor("plain")).toBe("plain");
	});

	it.each(["b", "中", "😀", "e\u0301"])("preserves the cursor grapheme %s and its display width", async (grapheme) => {
		const { barCursor } = await import("./vim-motion");
		const { CURSOR_MARKER, visibleWidth } = await import("@mariozechner/pi-tui");
		const line = `a${CURSOR_MARKER}\x1b[7m${grapheme}\x1b[0mc`;
		expect(barCursor(line)).toBe(`a${CURSOR_MARKER}\x1b[4m${grapheme}\x1b[0mc`);
		expect(visibleWidth(barCursor(line))).toBe(visibleWidth(line));
	});

	it.each([" ", "b", "中", "😀", "e\u0301"])("supports Pi 1.4 fake cursor markers over %j", async (grapheme) => {
		const { barCursor } = await import("./vim-motion");
		const { CURSOR_MARKER, visibleWidth } = await import("@mariozechner/pi-tui");
		const line = `a${CURSOR_MARKER}\x1b_pi:fc\x07${grapheme}\x1b_pi:/fc\x07c`;
		const cursor = grapheme === " " ? "▏" : `\x1b[4m${grapheme}\x1b[0m`;
		expect(barCursor(line)).toBe(`a${CURSOR_MARKER}${cursor}c`);
		expect(visibleWidth(barCursor(line))).toBe(visibleWidth(`a${CURSOR_MARKER}${grapheme}c`));
	});

	it("does not restyle unrelated reverse-video content", async () => {
		const { barCursor } = await import("./vim-motion");
		const { CURSOR_MARKER } = await import("@mariozechner/pi-tui");
		const line = `\x1b[7msuggestion\x1b[0m${CURSOR_MARKER}plain`;
		expect(barCursor(line)).toBe(line);
	});

	describe("escape sequence window", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(1000);
		});
		afterEach(() => {
			vi.useRealTimers();
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
