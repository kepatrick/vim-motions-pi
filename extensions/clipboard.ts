export type ClipboardAttempt = { command: string; args: string[] };
export type ClipboardRunner = (command: string, args: string[], text: string) => { error?: unknown; status: number | null | undefined };

export function clipboardAttemptsForPlatform(platform: NodeJS.Platform): ClipboardAttempt[] {
	// Allow overriding the clipboard command via env var.
	// Format: "command" or "command arg1 arg2 ..."
	const custom = process.env.VIM_MOTION_PI_CLIPBOARD_COMMAND;
	if (custom) {
		const parts = custom.trim().split(/\s+/);
		return [{ command: parts[0]!, args: parts.slice(1) }];
	}

	if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
	if (platform === "win32") {
		return [
			{ command: "clip", args: [] },
			{ command: "powershell", args: ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"] },
		];
	}
	return [
		{ command: "wl-copy", args: [] },
		{ command: "xclip", args: ["-selection", "clipboard"] },
		{ command: "xsel", args: ["--clipboard", "--input"] },
	];
}

export function tryClipboardWrite(text: string, platform: NodeJS.Platform, run: ClipboardRunner): boolean {
	if (!text) return false;
	for (const attempt of clipboardAttemptsForPlatform(platform)) {
		const result = run(attempt.command, attempt.args, text);
		if (!result.error && result.status === 0) return true;
	}
	return false;
}
