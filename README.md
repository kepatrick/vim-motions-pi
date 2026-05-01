# vim-motions-pi

A Vim-style motion extension for [pi](https://pi.dev).

It implements a focused subset of Vim editing behavior: modes, motions, operators, text objects, a single unnamed register, and a few editing helpers.

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

### Counts
- Prefix counts are supported for motions and many commands.
- Examples: `3w`, `2dd`, `5x`, `4G`

### Motions
- Character motions: `h j k l`
- Word motions: `w b e`
- Line motions: `0 ^ $`
- Buffer motions: `gg G`

### Find in the current line
- `f F t T`
- `;` repeats the last find
- `,` repeats the last find in reverse

### Operators
- `d y c`
- With motions: `dw`, `yw`, `cw`, `d$`, `y^`, etc.
- Linewise forms: `dd`, `yy`, `cc`, `D`, `C`, `S`
- Visual selections are also supported

### Text objects
- `iw aw`
- `iW aW`
- `ip ap`
- Works with operators, for example: `diw`, `yaw`, `ciW`, `dap`

### Editing helpers
- `x` / `X` delete forward or backward
- `p` / `P` paste after or before the cursor
- `u` undo
- `r<char>` replace one character
- `o` / `O` open a new line below or above
- `J` join with the next line
- `i` / `I` enter insert mode at cursor / first non-blank on line
- `a` / `A` enter insert mode after cursor / end of line
- `v` / `V` enter visual / visual-line mode

## Visual mode notes
- `o` swaps the visual selection ends.
- `v` exits visual mode.
- `V` switches to visual-line mode.
- `p` / `P` replace the selection with the current register contents.

## Register behavior
- Deletes and yanks are stored in a single unnamed register.
- `p` and `P` paste from that register.
- Linewise operations preserve line breaks when appropriate.

## Optional clipboard sync
This extension can mirror Vim's unnamed register to the system clipboard.

Set one parameter:

```bash
VIM_MOTION_PI_CLIPBOARD=off|all|yank
```

- `off`: disable clipboard sync
- `all`: sync yank/delete/change to clipboard
- `yank`: sync only yank operations

Use this command to change it inside pi:

```text
/vim-clipboard
```

It opens a native select menu with the available modes.

pi shows a short notification on startup and after changes.

When enabled, the unnamed register is mirrored to the system clipboard.
It uses the usual system clipboard command on your OS (`pbcopy`, `clip`, `wl-copy`, `xclip`, or `xsel`) if available.

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

This extension only affects the text input/editor area inside pi. It does not turn the whole application into Vim, and it does not apply to every UI component or global shortcut.

In insert mode, most keys are passed through to pi directly, except `Esc`, which switches back to normal mode.

In normal / visual modes, some pi hotkeys may be intercepted by Vim-style key handling and may not work as expected.

This is also a Vim-like subset, not full Vim.

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
