---
name: cheliped-browser
description: "Agent Browser Runtime for browsing, observing, and interacting with web pages via Chrome DevTools Protocol (CDP). Use this skill when Claude needs to: (1) navigate to and browse websites, (2) extract page content, text, or links from any URL, (3) fill forms or type into input fields, (4) click buttons or links on a page, (5) take screenshots of web pages, (6) execute JavaScript in a page context, (7) perform login or search actions on websites, (8) scrape or crawl web content, or any other browser-based task. Triggers on: browse, crawl, scrape, web page, website, navigate, open URL, screenshot a site, fill a form online, login to a site."
---

# Agent Browser Runtime

Control Chrome via CDP. Extract **Agent DOM** — a compressed DOM where every interactive element gets a numeric `agentId`.

## Setup

Run once before first use:

```bash
cd scripts && npm install && npm run build
```

## Core Workflow: Observe-Act Loop

```bash
# 1. Navigate and observe
node scripts/cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]'

# 2. Use agentId from observe output to interact
node scripts/cheliped-cli.mjs '[{"cmd":"fill","args":["3","search term"]},{"cmd":"click","args":["4"]},{"cmd":"observe"}]'
```

First call auto-launches Chrome and saves session. Subsequent calls reconnect. Call `close` when done.

## Commands

| Command | Args | Returns |
|---------|------|---------|
| `goto` | `["url"]` | `{ success, url, title }` |
| `observe` | none | `{ nodes, texts, links }` — `nodes[].id` = agentId |
| `click` | `["agentId"]` | `{ success, action, agentId }` |
| `fill` | `["agentId", "text"]` | `{ success, action, agentId }` |
| `screenshot` | `["path"]` (optional) | `{ success, path, size }` |
| `run-js` | `["expression"]` | `{ success, result }` |
| `extract` | `["text"\|"links"\|"all"]` | `{ type, data }` |
| `actions` | none | `[{ id, type, label, params }]` |
| `perform` | `["actionId"]` + `"params":{...}` | `{ success, actionId }` |
| `observe-graph` | none | `{ nodes, edges, forms }` |
| `back` | none | `{ success }` — navigate back in history |
| `forward` | none | `{ success }` — navigate forward in history |
| `hover` | `["agentId"]` | `{ success }` — hover over element |
| `scroll` | `["direction", "pixels"]` | `{ success }` — direction: up/down/left/right |
| `wait-for` | `["selector", "timeout"]` | `{ found }` — wait for CSS selector |
| `close` | none | `{ success }` |
| **Shadow DOM Commands** | | |
| `observe-shadow` | none | `{ shadowHosts: [{ hostSelector, elements, iframes }] }` |
| `click-deep` | `["selector"]` | `{ success }` — shadow-piercing click |
| `fill-deep` | `["selector", "text"]` | `{ success }` — shadow-piercing fill |
| **Iframe Commands** | | |
| `list-frames` | none | `{ frames: [{ index, url, name }] }` |
| `observe-frame` | `["target"]` | `{ url, elements: [{ index, tag, text, selector }] }` |
| `click-frame` | `["target", "selector"]` | `{ success }` — click inside iframe |
| `fill-frame` | `["target", "selector", "text"]` | `{ success }` — type into iframe input |
| `run-js-frame` | `["target", "expression"]` | `{ success, result }` — JS in iframe |

`target` = frame index (0-based number from `list-frames`) or URL substring to match.

## Examples

### Browse and extract content

```bash
node scripts/cheliped-cli.mjs '[{"cmd":"goto","args":["https://news.ycombinator.com"]},{"cmd":"observe"}]'
```

### Fill a form and submit

```bash
node scripts/cheliped-cli.mjs '[{"cmd":"observe"},{"cmd":"fill","args":["7","hello"]},{"cmd":"click","args":["8"]}]'
```

### Semantic action (login, search)

```bash
node scripts/cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com/login"]},{"cmd":"actions"}]'
node scripts/cheliped-cli.mjs '[{"cmd":"perform","args":["login-form"],"params":{"email":"user@example.com","password":"pass"}}]'
```

### Concurrent sessions

```bash
node scripts/cheliped-cli.mjs --session agent1 '[{"cmd":"goto","args":["https://site-a.com"]}]'
node scripts/cheliped-cli.mjs --session agent2 '[{"cmd":"goto","args":["https://site-b.com"]}]'
```

### Interact with shadow DOM content (e.g. Cloudflare Turnstile, web components)

```bash
# 1. Discover shadow DOM hosts and their contents
node scripts/cheliped-cli.mjs '[{"cmd":"observe-shadow"}]'

# 2. Click element inside shadow DOM (pierces shadow boundaries recursively)
node scripts/cheliped-cli.mjs '[{"cmd":"click-deep","args":["input[type=checkbox]"]}]'

# 3. Use ">>>" to explicitly cross shadow DOM boundaries
node scripts/cheliped-cli.mjs '[{"cmd":"click-deep","args":["#turnstile-widget >>> input[type=checkbox]"]}]'

# 4. Fill input inside shadow DOM
node scripts/cheliped-cli.mjs '[{"cmd":"fill-deep","args":["#shadow-host >>> input[name=email]","user@example.com"]}]'
```

`click-deep` and `fill-deep` use absolute coordinate dispatch for real mouse events. Plain selectors auto-search all shadow roots recursively. Use `>>>` to target specific shadow host → inner element paths.

### Interact with iframe content (e.g. Cloudflare Turnstile, CAPTCHA, embedded widgets)

```bash
# 1. List all iframes on the page
node scripts/cheliped-cli.mjs '[{"cmd":"list-frames"}]'

# 2. Observe elements inside iframe at index 0
node scripts/cheliped-cli.mjs '[{"cmd":"observe-frame","args":["0"]}]'

# 3. Click a checkbox inside the iframe (use CSS selector from observe-frame output)
node scripts/cheliped-cli.mjs '[{"cmd":"click-frame","args":["0","input[type=checkbox]"]}]'

# Or match iframe by URL substring instead of index
node scripts/cheliped-cli.mjs '[{"cmd":"click-frame","args":["turnstile","input[type=checkbox]"]}]'
```

The iframe commands use absolute coordinate dispatch (iframe position + element position) to produce real mouse events that pass bot detection.

## Key Notes

- Call `observe` before `click`/`fill` — agentIds are only valid after observation.
- `fill` works with React/SPA apps (uses native input value setters).
- Agent DOM is token-compressed — far fewer tokens than raw HTML.
- Chrome persists between calls until `close`. No restart needed.
- All output is JSON to stdout. Errors: `{ "error": "message" }`.
- For shadow DOM content (Cloudflare Turnstile, web components): use `observe-shadow` → `click-deep`/`fill-deep`. Supports `>>>` syntax to pierce shadow boundaries.
- For iframe content (embedded widgets): use `list-frames` → `observe-frame` → `click-frame`/`fill-frame`. Regular `observe`/`click` cannot interact with iframe elements.
- `list-frames` also discovers iframes hidden inside shadow DOM.
