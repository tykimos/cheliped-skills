---
name: cheliped-computer-use
description: "Control the local macOS machine — move/click the mouse, type and press key combos, take screenshots, and launch/quit/activate apps via AppleScript and native CLI tools. Use this skill when Claude needs to: (1) take a screenshot of the Mac screen, (2) move or click the mouse at coordinates, (3) type text or send keyboard shortcuts to any app, (4) open, activate, or quit macOS applications, (5) open a URL or file with the default handler, (6) run arbitrary AppleScript or shell commands, or any other desktop/GUI automation on the Mac. Triggers on: control my mac, click on screen, type into app, take a screenshot, open app, automate desktop, keyboard shortcut, mouse, GUI automation."
---

# Cheliped Computer Use (macOS)

Drive the local Mac from the terminal. One CLI takes a JSON array of commands and returns JSON — the same shape as the `browser` skill.

## Output Envelope

Output is **always a JSON array**, one envelope per command, **compact by default**:

```json
[{ "cmd": "screenshot", "ok": true,  "result": { "path": "...", "scale": 2 } },
 { "cmd": "type",       "ok": false, "error": { "code": "E_NO_PERMISSION", "message": "..." } }]
```

Each command runs even if a prior one fails (per-command isolation). Error `code` is one of `E_NO_PERMISSION` (Accessibility off), `E_NO_CLICLICK`, `E_WRONG_FOCUS`, `E_DISABLED` (escape hatch not enabled), `E_BAD_ARG`, `E_UNKNOWN_CMD`, `E_TIMEOUT`, `E_UNKNOWN`.

Flags (before the JSON arg): `--pretty` indents output; `--allow-shell` enables the `run-shell` / `run-applescript` escape hatches (off by default).

## Setup

Built-ins (`osascript`, `screencapture`) need no install. Mouse control needs **cliclick**:

```bash
brew install cliclick
```

**Permissions:** the terminal/agent process must be granted **Accessibility** and **Screen Recording** in System Settings → Privacy & Security. The CLI now **preflights Accessibility** and returns `E_NO_PERMISSION` (instead of a silent no-op) when keyboard/mouse input would not be delivered; screenshots that come back near-uniform get a `warning` hinting at missing Screen Recording. Grant the permissions, then **restart the terminal** (permissions only apply to a freshly launched process).

## Core Workflow: Observe-Act Loop

```bash
# 1. See the screen
node scripts/computer-cli.mjs '[{"cmd":"screenshot","args":["/tmp/now.png"]}]'

# 2. Act on what you saw (read the screenshot, then click / type)
node scripts/computer-cli.mjs '[{"cmd":"click","args":[640,400]},{"cmd":"type","args":["hello"]}]'
```

Read the screenshot with the Read tool, decide coordinates, then act. Re-screenshot to confirm.

## Commands

Each row's `Returns` is the `result` object inside the envelope.

| Command | Args | Returns |
|---------|------|---------|
| `screenshot` | `["path"]` (optional); fields `region:[x,y,w,h]`, `maxWidth:n` | `{ path, pixelWidth, pixelHeight, pointWidth, pointHeight, scale, cropOffset?, warning? }` |
| `screen-size` | none | `{ width, height, unit:"point", scale }` |
| `mouse-pos` | none | `{ x, y, unit:"point" }` *(needs cliclick)* |
| `move` | `[x, y]` | `{ x, y }` *(cliclick)* |
| `click` | `[x, y]` (optional → current pos) | `{}` *(cliclick)* |
| `double-click` | `[x, y]` (optional) | `{}` *(cliclick)* |
| `right-click` | `[x, y]` (optional) | `{}` *(cliclick)* |
| `drag` | `[x1, y1, x2, y2]` | `{}` *(cliclick)* |
| `scroll` | `[amount]` (+ up / − down; `|amount|/5` pages) | `{ pages }` |
| `type` | `["text"]`; fields `target:"App"`, `noClipboard:true` | `{ method:"keystroke"\|"paste" }` |
| `paste` | `["text"]` (optional → current clipboard); field `target` | `{ method:"paste" }` |
| `key` | `["combo"]` e.g. `"cmd c"`; field `target:"App"` | `{ combo }` |
| `launch` | `["AppName"]` | `{ app }` |
| `activate` | `["AppName"]` | `{ app }` |
| `quit` | `["AppName"]` | `{ app }` |
| `open` | `["url-or-path"]` | `{ target }` |
| `list-apps` | none | `{ apps: [...] }` — visible running apps |
| `frontmost` | none | `{ app }` — active app |
| `notify` | `["text", "title"]` | `{}` — banner notification |
| `run-applescript` | `["script"]` *(needs `--allow-shell`)* | `{ result, audited }` |
| `run-shell` | `["command"]` *(needs `--allow-shell`)* | `{ stdout, audited }` |
| `wait` | `[ms]` | `{}` |

**Typing (IME-safe):** `type` sends ASCII as keystrokes but routes non-ASCII / multiline text (한글, 漢字, emoji, newlines) through a clipboard paste so it lands intact in CJK/IME fields — it saves and restores your clipboard (pass `noClipboard:true` to opt out). Pass `target:"AppName"` on `type`/`key`/`paste` to verify that app is frontmost first (re-activates once, else `E_WRONG_FOCUS`) — prevents typing into the wrong window.

**Coordinates** are in **points** everywhere (input and the `point*` fields); `scale` tells you the pixel↔point ratio. `screenshot` `region`/`maxWidth` crop and downscale to cut image tokens; add `cropOffset` to coordinates read off a cropped image to map back to the full screen.

## Key combos

`key` accepts modifiers `cmd`, `ctrl`/`control`, `alt`/`opt`/`option`, `shift` plus one target.
Named targets: `enter`/`return`, `tab`, `space`, `escape`/`esc`, `delete`/`backspace`, arrows
(`up`/`down`/`left`/`right`), `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, or any single character.

```bash
node scripts/computer-cli.mjs '[{"cmd":"key","args":["cmd c"]}]'        # copy
node scripts/computer-cli.mjs '[{"cmd":"key","args":["cmd shift 4"]}]'  # area screenshot
node scripts/computer-cli.mjs '[{"cmd":"key","args":["escape"]}]'
```

## Examples

### Open an app, type, and save

```bash
node scripts/computer-cli.mjs '[
  {"cmd":"launch","args":["TextEdit"]},
  {"cmd":"wait","args":[800]},
  {"cmd":"type","args":["Notes from Claude"]},
  {"cmd":"key","args":["cmd s"]}
]'
```

### Screenshot → inspect → click

```bash
node scripts/computer-cli.mjs '[{"cmd":"screenshot","args":["/tmp/screen.png"]},{"cmd":"screen-size"}]'
# Read /tmp/screen.png, work out the target coordinate, then:
node scripts/computer-cli.mjs '[{"cmd":"click","args":[512,288]}]'
```

### Open a URL in the default browser

```bash
node scripts/computer-cli.mjs '[{"cmd":"open","args":["https://example.com"]}]'
```

## Key Notes

- Output is always a JSON array of `{ cmd, ok, result|error }` envelopes (see **Output Envelope** above), compact by default; `--pretty` to indent. Each command is isolated — one failure doesn't stop the batch.
- Coordinates are in **points**. `screenshot` reports both pixel and point dimensions plus `scale`, so you no longer have to guess the Retina factor — divide nothing, just use the `point*` values (and `cropOffset` for cropped captures).
- Mouse commands require `cliclick`; missing → `E_NO_CLICLICK`. Keyboard/app/screenshot are native. Keyboard & mouse also require **Accessibility** — missing → `E_NO_PERMISSION` (no more silent no-op).
- This skill controls the **real machine** — it moves the actual cursor and types into whatever app is focused. Use `target:"AppName"` on `type`/`key` to assert the right window is frontmost before typing.
- `run-shell` / `run-applescript` are arbitrary host execution and are **disabled unless you pass `--allow-shell`**.
- For web automation prefer the sibling **browser** skill (CDP-based, no real cursor); use computer-use for native apps and OS-level GUI tasks.
