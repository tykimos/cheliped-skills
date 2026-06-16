---
name: cheliped-computer-use
description: "Control the local macOS machine — move/click the mouse, type and press key combos, take screenshots, and launch/quit/activate apps via AppleScript and native CLI tools. Use this skill when Claude needs to: (1) take a screenshot of the Mac screen, (2) move or click the mouse at coordinates, (3) type text or send keyboard shortcuts to any app, (4) open, activate, or quit macOS applications, (5) open a URL or file with the default handler, (6) run arbitrary AppleScript or shell commands, or any other desktop/GUI automation on the Mac. Triggers on: control my mac, click on screen, type into app, take a screenshot, open app, automate desktop, keyboard shortcut, mouse, GUI automation."
---

# Cheliped Computer Use (macOS)

Drive the local Mac from the terminal. One CLI takes a JSON array of commands and returns JSON — the same shape as the `browser` skill.

## Setup

Built-ins (`osascript`, `screencapture`) need no install. Mouse control needs **cliclick**:

```bash
brew install cliclick
```

**Permissions:** the terminal/agent process must be granted **Accessibility** and **Screen Recording** in System Settings → Privacy & Security. Without Accessibility, keyboard/mouse commands silently no-op; without Screen Recording, screenshots come back black.

## Core Workflow: Observe-Act Loop

```bash
# 1. See the screen
node scripts/computer-cli.mjs '[{"cmd":"screenshot","args":["/tmp/now.png"]}]'

# 2. Act on what you saw (read the screenshot, then click / type)
node scripts/computer-cli.mjs '[{"cmd":"click","args":[640,400]},{"cmd":"type","args":["hello"]}]'
```

Read the screenshot with the Read tool, decide coordinates, then act. Re-screenshot to confirm.

## Commands

| Command | Args | Returns |
|---------|------|---------|
| `screenshot` | `["path"]` (optional) | `{ success, path }` — silent full-screen capture |
| `screen-size` | none | `{ width, height }` |
| `mouse-pos` | none | `{ x, y }` *(needs cliclick)* |
| `move` | `[x, y]` | `{ success, x, y }` *(cliclick)* |
| `click` | `[x, y]` (optional → current pos) | `{ success }` *(cliclick)* |
| `double-click` | `[x, y]` (optional) | `{ success }` *(cliclick)* |
| `right-click` | `[x, y]` (optional) | `{ success }` *(cliclick)* |
| `drag` | `[x1, y1, x2, y2]` | `{ success }` *(cliclick)* |
| `scroll` | `[amount]` (+ up / − down) | `{ success, pages }` |
| `type` | `["text"]` | `{ success }` |
| `key` | `["combo"]` e.g. `"cmd c"`, `"cmd shift 4"`, `"enter"` | `{ success, combo }` |
| `launch` | `["AppName"]` | `{ success, app }` |
| `activate` | `["AppName"]` | `{ success, app }` |
| `quit` | `["AppName"]` | `{ success, app }` |
| `open` | `["url-or-path"]` | `{ success, target }` |
| `list-apps` | none | `{ apps: [...] }` — visible running apps |
| `frontmost` | none | `{ app }` — active app |
| `notify` | `["text", "title"]` | `{ success }` — banner notification |
| `run-applescript` | `["script"]` | `{ success, result }` |
| `run-shell` | `["command"]` | `{ success, stdout }` |
| `wait` | `[ms]` | `{ success }` |

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

- All output is JSON to stdout. A single command returns one object; multiple return an array. Errors: `{ "cmd": "...", "error": "message" }` per command — the batch keeps going.
- Screenshot coordinates are in screen points; on Retina displays the PNG pixels are 2× the point coordinates, but `click`/`move` use **points**, so divide pixel positions by the scale factor (≈2) before clicking.
- Mouse commands require `cliclick`; if it's missing you get a clear install error. Keyboard, app, and screenshot commands are all native.
- This skill controls the **real machine** — it will move the actual cursor and type into whatever app is focused. Make sure the right window is frontmost (`activate`) before typing.
- For web automation prefer the sibling **browser** skill (CDP-based, no real cursor); use computer-use for native apps and OS-level GUI tasks.
