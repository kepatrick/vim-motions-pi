import { beforeEach, describe, expect, it, vi } from "vitest";

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
		handleInput(_data: string): void {}
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
});
