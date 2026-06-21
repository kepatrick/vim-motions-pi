# vim-motions-pi

[![npm version](https://img.shields.io/npm/v/vim-motions-pi.svg)](https://www.npmjs.com/package/vim-motions-pi)

A focused Vim-style editing layer for [pi](https://pi.dev): fast motions, text objects, visual selections, and optional clipboard sync.

It brings the essential Vim editing loop into pi without the full Vim complexity.

## At a glance

Edit faster inside pi, with the Vim commands people actually reach for.

- Move with `h j k l`, `w b e`, `0 ^ $`, and `gg G`
- Change text with `dw`, `ciw`, `dd`, `yy`, `p`, `u`, and `r<char>`
- Select with `v` / `V`, then yank, delete, or paste
- Target regions with text objects like `iw`, `aw`, `ip`, and `ap`
- Mirror yank/delete/change operations to the system clipboard when enabled

## Quick demo

![Quick demo of vim-motions-pi](./demo.gif)

## Install

Install with pi:

```bash
pi install npm:vim-motions-pi
```

Or try it for the current run only:

```bash
pi -e npm:vim-motions-pi
```

## Local development / test

Run the extension directly from this repo:

```bash
pi -e ./extensions/vim-motion.ts
```

## What it supports

### Modes
- `insert`
- `normal`
- `visual`
- `visual-line`

### Core motions
- Character motions: `h j k l`
- Word motions: `w b e`
- Line motions: `0 ^ $`
- Buffer motions: `gg G`
- Find motions: `f F t T`
- Repeat find: `;` and `,`

### Editing actions
- Operators: `d y c`
- Motion-based edits: `dw`, `yw`, `cw`, `d$`, `y^`, etc.
- Linewise forms: `dd`, `yy`, `cc`, `D`, `C`, `S`
- Direct helpers: `x`, `X`, `p`, `P`, `u`, `r<char>`, `o`, `O`, `J`, `i`, `I`, `a`, `A`

### Selection
- `v` enters visual mode
- `V` enters visual-line mode
- Visual selections support `y`, `d`, and `p`

### Text objects
- `iw`, `aw`
- `iW`, `aW`
- `i"`, `a"`
- `ip`, `ap`
- Works with operators, for example: `diw`, `yaw`, `ciW`, `ci"`, `dap`

### Counts
- Prefix counts are supported for motions and many commands
- Examples: `3w`, `2dd`, `5x`, `4G`

## Visual mode notes
- `o` swaps the visual selection ends.
- `v` exits visual mode.
- `V` switches to visual-line mode.
- `p` / `P` replace the selection with the current register contents.

## Register behavior
- Yanks, deletes, and changes go to a single unnamed register.
- `p` and `P` paste from that register.
- Linewise operations keep line breaks when that makes sense.

## Optional clipboard sync
Keep the unnamed register in sync with your system clipboard.

Set one parameter:

```bash
VIM_MOTION_PI_CLIPBOARD=off|all|yank
```

- `off`: disable clipboard sync
- `all`: sync yank, delete, and change operations
- `yank`: sync only yank operations

Change it inside pi with:

```text
/vim-clipboard
```

pi shows a short notification when the mode changes.

When enabled, the extension uses the usual clipboard command on your OS (`pbcopy`, `clip`, `wl-copy`, `xclip`, or `xsel`) if available.

### Custom clipboard command

Override the auto-detected clipboard command with your own:

```bash
VIM_MOTION_PI_CLIPBOARD_COMMAND="my-clipboard-tool --copy"
```

The value is split on whitespace; the first word is the command and the rest are arguments. The selected text is passed via stdin.

This is useful inside tmux/SSH sessions where `wl-copy` or `xclip` may not work, and you want to route clipboard through OSC 52 or another transport.

## Custom escape sequence

By default only `Esc` leaves insert mode. You can enable a two-key sequence such as `jk` or `jj`:

```bash
VIM_MOTION_PI_ESCAPE_SEQUENCE=jk
```

- The sequence must be at least two characters.
- While typing in insert mode, the extension buffers keystrokes. When the buffer ends with the configured sequence, the sequence characters are deleted and the editor returns to normal mode.
- If you partially match (e.g. typed `j` but then pressed `l`), the `j` is preserved and passed through.

## Examples

```text
3w      move forward 3 words
ciw     change inner word
daw     delete around word
yy      yank current line
p       paste yanked text
f,      find the next comma
;       repeat the last find
```

## Limitations

This is a Vim-like subset, not full Vim.

It only affects the text input/editor area inside pi, not the whole app.

In insert mode, most keys pass through to pi directly, except `Esc`, which returns to normal mode.

In normal / visual modes, some pi hotkeys may be intercepted by Vim-style key handling.

Not supported:
- search with `/` or `?`
- macros
- marks
- dot-repeat (`.`)
- multiple named registers

## Uninstall

```bash
pi remove npm:vim-motions-pi
```

## Source

- GitHub: https://github.com/kepatrick/vim-motions-pi
- Source lives in `extensions/vim-motion.ts`
