<div align="center">

# 🦀 Cheliped Skills

**Give your AI agent real hands — on the web and on your Mac.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE.txt)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-skills-ff6b35?style=for-the-badge)]()

</div>

---

Cheliped Skills is a collection of agent skills. *Cheliped* is a crab's claw 🦀 — the part that grabs.

## Skills

| Skill | What it does | Backend |
|-------|--------------|---------|
| [**browser**](browser/) | Browse, observe, click, fill, screenshot, and scrape web pages. Exposes an LLM-friendly **Agent DOM** where every interactive element gets a numeric id. | Chrome DevTools Protocol (CDP) |
| [**computer-use**](computer-use/) | Control the local macOS machine — mouse, keyboard, screenshots, and launching/quitting apps. | AppleScript + native CLI (`osascript`, `screencapture`, `cliclick`) |

Each skill is self-contained with its own `SKILL.md` and `scripts/`.

## Quick start

```bash
# Browser skill (web automation)
cd browser/scripts && npm install && npm run build
node cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]'

# Computer-use skill (macOS control)
brew install cliclick   # for mouse control; keyboard/screenshots are native
node computer-use/scripts/computer-cli.mjs '[{"cmd":"screenshot"},{"cmd":"screen-size"}]'
```

See each skill's `SKILL.md` for the full command reference.

## When to use which

- **browser** — anything on a web page. CDP-driven, no real cursor, token-compressed DOM, runs headless.
- **computer-use** — native macOS apps and OS-level GUI tasks. Moves the real cursor and types into the focused window.

## License

MIT — see [LICENSE.txt](LICENSE.txt).
