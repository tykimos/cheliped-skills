<div align="center">

# 🦀 Cheliped Browser

**Give your AI agent real eyes on the web.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE.txt)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-ff6b35?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgZmlsbD0id2hpdGUiLz48L3N2Zz4=)]()
[![OpenClaw](https://img.shields.io/badge/OpenClaw-compatible-e44d26?style=for-the-badge)]()

*Browse · Observe · Click · Fill · Search · Extract — all from the terminal.*

[Getting Started](#-getting-started) · [How It Works](#-how-it-works) · [Commands](#-commands) · [Examples](#-examples) · [Architecture](#-architecture)

</div>

---

## What is this?

Cheliped is a **browser automation skill** for AI agents. It controls Chrome via the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) and exposes an LLM-friendly view of web pages called **Agent DOM** — a compressed, semantically structured representation where every interactive element gets a numeric ID.

> **Why "Cheliped"?** — A cheliped is a crab's claw. 🦀 This tool is the claw that lets your AI agent grab things from the web.

---

## 🏗 Architecture

```
cheliped-browser/
├── SKILL.md                    # Skill definition
├── LICENSE.txt                 # MIT
└── scripts/
    ├── cheliped-cli.mjs        # CLI entry point
    ├── src/
    │   ├── api/                # Cheliped class — main API
    │   ├── cdp/                # CDP connection + transport + launcher
    │   ├── dom/                # Agent DOM builder, extractor, compressor
    │   ├── graph/              # UI graph + semantic action generator
    │   ├── security/           # Domain allowlist, prompt guard
    │   └── session/            # Cookie persistence
    ├── tests/                  # Unit + integration tests
    └── examples/               # Demo scripts
```

### Agent DOM Pipeline

The core concept of Cheliped is the **Agent DOM** — a compressed, LLM-friendly representation of a web page. Here's how a raw DOM tree is transformed into an Agent DOM:

```mermaid
flowchart LR
    subgraph Chrome["Chrome (CDP)"]
        DOM["Raw DOM Tree\n~130K tokens"]
        IFrame["iframe Content"]
    end

    subgraph Pipeline["Agent DOM Pipeline"]
        EXT["DomExtractor\nFull tree + iframes\n(parallel extraction)"]
        FIL["DomFilter\nRemove hidden,\nscript, style"]
        SEM["SemanticExtractor\nCategorize:\nbutton, link,\ninput, text..."]
        CMP["TokenCompressor\nTruncate text,\nlimit counts"]
        BLD["AgentDomBuilder\nAssign agentId\n→ backendNodeId\nmapping"]
    end

    subgraph Output["Agent DOM (~2.5K tokens)"]
        JSON["buttons: [{id:3, text}]\nlinks: [{id:6, href}]\ninputs: [{id:5, type}]\ntexts: [{id:8, text}]"]
    end

    DOM --> EXT
    IFrame -.-> EXT
    EXT --> FIL --> SEM --> CMP --> BLD --> JSON

    style Chrome fill:#f8f9fa,stroke:#dee2e6,color:#212529
    style Pipeline fill:#e9ecef,stroke:#adb5bd,color:#212529
    style Output fill:#d4edda,stroke:#28a745,color:#212529
```

### Observe-Act Loop & ID Mapping

The agent interacts with pages through a simple **observe → act → observe** loop. The key mechanism is the `agentId ↔ backendNodeId` mapping:

```mermaid
flowchart TB
    subgraph Agent["AI Agent (LLM)"]
        OBS["observe()"]
        ACT["act(agentId, action)"]
        REASON["Reason about\nAgent DOM JSON"]
    end

    subgraph Cheliped["Cheliped Core"]
        ADOM["AgentDomBuilder\nidMap: agentId → backendNodeId"]
        RESOLVE["resolveAgentId(3)\n→ backendNodeId: 847"]
        CTRL["BrowserController\nclick / fill / select\nby backendNodeId"]
    end

    subgraph CDP["Chrome DevTools Protocol"]
        DOMAPI["DOM.getDocument\nDOM.getBoxModel\nDOM.resolveNode"]
        INPUT["Input.dispatchMouseEvent\nInput.insertText\nDOM.focus"]
    end

    OBS --> ADOM
    ADOM -->|"Agent DOM JSON\n{buttons:[{id:3,...}]}"| REASON
    REASON -->|"click 3"| ACT
    ACT --> RESOLVE
    RESOLVE --> CTRL
    CTRL --> DOMAPI
    CTRL --> INPUT
    INPUT -->|"Page state changed"| OBS

    style Agent fill:#fff3cd,stroke:#ffc107,color:#212529
    style Cheliped fill:#cce5ff,stroke:#0d6efd,color:#212529
    style CDP fill:#f8f9fa,stroke:#6c757d,color:#212529
```

### Element Category Classification

The semantic extractor classifies DOM elements into 8 categories. Only non-empty categories are included in the output (token optimization):

```mermaid
flowchart LR
    subgraph HTML["HTML Elements"]
        BTN["button\n[role=button]"]
        A["a[href]\n[role=link]"]
        INP["input\n[role=textbox]\n[role=checkbox]"]
        SEL["select"]
        TA["textarea"]
        FORM["form"]
        TXT["h1-h6, p, li\nlabel, span, td"]
        IMG["img"]
    end

    subgraph AgentDom["Agent DOM Categories"]
        B["buttons[]"]
        L["links[]"]
        I["inputs[]"]
        S["selects[]"]
        T2["textareas[]"]
        F["forms[]"]
        TX["texts[]"]
        IM["images[]"]
    end

    BTN --> B
    A --> L
    INP --> I
    SEL --> S
    TA --> T2
    FORM --> F
    TXT --> TX
    IMG --> IM

    style HTML fill:#f8f9fa,stroke:#dee2e6,color:#212529
    style AgentDom fill:#d4edda,stroke:#28a745,color:#212529
```

---

## ⚡ At a Glance

> Avg **1,932 tokens** per page · **33ms** observe speed · **88.9%** quality score

| | Cheliped | OpenClaw Browser | Tandem Browser | agent-browser | Playwright | Puppeteer |
|:--|:---------|:-----------------|:---------------|:--------------|:-----------|:----------|
| **Best for** | LLM agent browsing | Full-featured agent platform | Human-AI co-browsing | CLI automation | Full browser testing | Headless scripting |
| **Avg Tokens** | **2,198** | 16,762 (4,251 efficient) | 10,631 | 11,802 | 5,672 | 5,020 |
| **Avg Speed** | **33ms** | 1,280ms | 81ms | 208ms | 69ms | 63ms |
| **Quality** | **88.9%** | — | — | 72.9% | 75.6% | 73.7% |
| **Output Format** | Structured JSON (categorized arrays) | YAML accessibility tree | Indented AXTree text | Raw text | Flat a11y tree | Flat a11y tree |
| **Element IDs** | Numeric `agentId` | Symbolic `[ref=eN]` | `@ref` labels (`@e1`) | None | CSS selectors | CSS selectors |
| **Dependencies** | ws only | playwright-core | Electron + CDP | Rust binary | Full framework | Full framework |
| **iframe/Shadow DOM** | Same-origin only | Full (via Playwright) | Via Electron | No | Partial | Partial |
| **SPA Support** | Basic | Excellent | Good | Basic | Excellent | Good |
| **Wait Strategy** | Network idle | Auto-wait (Playwright) | MutationObserver settling | Manual | Auto-wait | Manual |
| **Security Model** | Domain allowlist | None | 6-layer (network, JS AST, behavior) | None | None | None |
| **Production Maturity** | Early | Production | Developer Preview | Stable | Mature | Mature |

*For detailed benchmarks, see [Full Benchmark Results](#-full-benchmark-results) below.*

---

## 🤖 Why Claude Code & OpenClaw?

Cheliped is not a general-purpose browser automation library. It is a **skill** — purpose-built for AI agent platforms that need to browse the web as part of larger tasks. Here's why the design fits Claude Code and OpenClaw specifically:

### The Problem: LLMs Can't See Web Pages

When an AI agent needs to "check a website" or "fill out a form", it faces a fundamental challenge: web pages are visual, but LLMs process text. Existing solutions have trade-offs:

| Approach | Problem for AI Agents |
|:---------|:---------------------|
| **Raw HTML** | 30,000–130,000 tokens per page. Blows up context windows, costs spike, reasoning quality drops. |
| **Screenshots** | Vision models can read them, but can't interact. "Click the blue button" requires knowing coordinates. |
| **Playwright / Puppeteer** | Designed for human developers writing test scripts — not for LLMs making autonomous decisions. Requires CSS selectors the LLM must construct. |
| **Accessibility trees** | Flat, verbose, no interaction IDs. The LLM must parse tree structure to understand the page. |

### The Solution: Agent DOM

Cheliped solves this with **Agent DOM** — a representation designed specifically for how LLMs reason:

```json
{
  "buttons": [{"id": 3, "text": "Submit"}, {"id": 4, "text": "Cancel"}],
  "inputs":  [{"id": 5, "placeholder": "Email", "type": "email"}],
  "links":   [{"id": 6, "text": "Forgot password?", "href": "/reset"}],
  "texts":   ["Welcome back! Please sign in to continue."]
}
```

The LLM instantly knows: there are 2 buttons, 1 input field, 1 link, and context text. To fill the email field, it says `fill 5 "user@example.com"`. To submit, it says `click 3`. No CSS selectors, no XPath, no coordinate calculation.

### How It Integrates with Claude Code

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) discovers skills automatically via `SKILL.md`. When a user asks Claude to "check a website" or "fill out a form", Claude Code:

1. **Detects the trigger** — SKILL.md's description matches browsing-related intents
2. **Reads the skill** — learns the `observe → act → observe` workflow and available commands
3. **Executes via CLI** — runs `node scripts/cheliped-cli.mjs '[...]'` with JSON commands
4. **Parses JSON output** — Agent DOM comes back as structured JSON to stdout, directly consumable

```
User: "Check the top 3 stories on Hacker News"
    │
    ▼
Claude Code: detects browsing intent → loads cheliped-browser skill
    │
    ▼
Shell: node cheliped-cli.mjs '[{"cmd":"goto","args":["https://news.ycombinator.com"]},{"cmd":"observe"}]'
    │
    ▼
Agent DOM (JSON): {"links": [{"id":1, "text":"Story 1", "href":"..."}, ...], "texts": [...]}
    │
    ▼
Claude Code: parses Agent DOM → responds "The top 3 stories are: 1. ... 2. ... 3. ..."
```

Key design choices for Claude Code compatibility:
- **All output is JSON to stdout** — no interactive prompts, no TUI, no color codes. Pure machine-readable output.
- **Stateless CLI calls** — each invocation is a standalone command. Claude Code doesn't maintain process state between tool calls.
- **Session persistence via Chrome** — Chrome stays alive between CLI calls. Claude Code can `goto` in one turn, `observe` in the next, `click` in the third — all on the same browser session.
- **Error format** — failures return `{"error": "message"}` so Claude can reason about what went wrong.

### How It Integrates with OpenClaw

[OpenClaw](https://openclaw.org) uses the same skill discovery pattern. When installed at `~/.openclaw/skills/cheliped-browser/`, OpenClaw agents can:

1. **Auto-discover** — OpenClaw scans the skills directory and reads SKILL.md metadata
2. **Invoke the browser tool** — agents call cheliped commands through the `browser` tool interface
3. **Multi-agent browsing** — `--session` flag lets different OpenClaw agents browse independently with isolated Chrome instances

```
OpenClaw Agent: "What are the top 3 stories on Hacker News?"
    │
    ▼
OpenClaw: skill match → cheliped-browser → browser tool
    │
    ▼
Cheliped: goto → observe → Agent DOM
    │
    ▼
Agent: "The top 3 Hacker News stories are: 1. ... 2. ... 3. ..."
```

### Why Not Just Use Playwright/Puppeteer Directly?

AI agent platforms *could* give LLMs direct access to Playwright or Puppeteer. But:

| | Cheliped (Skill) | Playwright/Puppeteer (Direct) |
|:--|:-----------------|:-----------------------------|
| **LLM must know** | 10 simple commands (`goto`, `observe`, `click`, `fill`, ...) | Hundreds of API methods, CSS selector syntax, async patterns |
| **Interaction** | `click 3` (numeric ID) | `page.click('button.submit-form:nth-child(2)')` (fragile selector) |
| **Token cost** | ~1,932 tokens avg | ~5,000–12,000 tokens avg |
| **Context needed** | SKILL.md (~80 lines) | Full API docs (thousands of lines) |
| **Error recovery** | Simple JSON errors | Stack traces, timeout errors, selector not found |
| **Install** | `npm install` (ws only) | Full browser framework + browser binary |

Cheliped abstracts away browser complexity so the LLM can focus on **what to do**, not **how to do it**.

### Design Principles

1. **Token-first** — Every design decision optimizes for fewer tokens. LLM API costs scale with token count; fewer tokens = cheaper and faster agent runs.
2. **Observe-Act loop** — Matches reinforcement learning patterns that LLMs handle naturally. Observe state → reason → act → observe new state.
3. **Numeric IDs over selectors** — LLMs are better at referencing `id: 3` than constructing `div.container > form > button:first-child`. Selectors break on DOM changes; numeric IDs are always valid after the latest `observe`.
4. **JSON in, JSON out** — No parsing ambiguity. The LLM sends JSON commands and receives JSON results. No regex needed, no text scraping.
5. **Zero-config for agents** — First call auto-launches Chrome. No setup step needed in the agent's workflow. Just `goto` and go.

---

## 🚀 Getting Started

### As a Claude Code Skill

Claude Code discovers skills from `~/.claude/skills/`. Once installed, Claude automatically uses Cheliped whenever it detects browsing-related tasks ("check this website", "fill out this form", "scrape this page").

```bash
git clone https://github.com/tykimos/cheliped-browser.git ~/.claude/skills/cheliped-browser
cd ~/.claude/skills/cheliped-browser/scripts && npm install && npm run build
```

No configuration needed. Claude Code reads `SKILL.md`, learns the commands, and starts using them autonomously.

### As an OpenClaw Skill

OpenClaw discovers skills from `~/.openclaw/skills/`. The agent can invoke Cheliped through OpenClaw's `browser` tool interface, with the same observe-act workflow.

```bash
git clone https://github.com/tykimos/cheliped-browser.git ~/.openclaw/skills/cheliped-browser
cd ~/.openclaw/skills/cheliped-browser/scripts && npm install && npm run build

# Also symlink to workspace for full compatibility
ln -s ~/.openclaw/skills/cheliped-browser ~/.openclaw/workspace/skills/cheliped-browser
```

### Standalone (No AI Agent)

Cheliped can also be used directly from the command line for scripting or testing:

```bash
git clone https://github.com/tykimos/cheliped-browser.git && cd cheliped-browser
cd scripts && npm install && npm run build
node cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]'
```

---

## 🧩 How It Works

### The Key Difference: Agent DOM vs Raw Snapshots

Most browser tools give LLMs raw accessibility trees or HTML snapshots. Cheliped takes a fundamentally different approach:

| Approach | Cheliped | Playwright / Puppeteer | agent-browser |
|:---------|:---------|:----------------------|:--------------|
| **Output format** | Structured JSON with categorized arrays (`buttons`, `links`, `inputs`, `texts`, `headings`) | Flat accessibility tree or ARIA snapshot (text/YAML) | Raw text extraction |
| **Element IDs** | Every interactive element gets a numeric `agentId` for direct interaction | CSS selectors or XPath (agent must construct) | No direct interaction |
| **Protocol** | Direct CDP WebSocket — no framework overhead | Full browser framework (Playwright/Puppeteer) | Rust binary with CDP |
| **Pipeline** | DOM → Filter (visible only) → Semantic grouping → Compression → Dedup | Single-pass a11y tree dump | Single-pass text extraction |
| **Token efficiency** | ~3,017 avg tokens (semantic compression + dedup) | ~5,000–5,700 tokens (full tree) | ~11,950 tokens (verbose text) |

**Why this matters for LLM agents:** An LLM receiving `{"buttons": [{"id": 3, "text": "Submit"}]}` can immediately reason about what to click. With a flat a11y tree like `button "Submit"`, the agent must parse the tree structure, find the element, and figure out how to reference it for interaction.

### The Observe-Act Loop

```
  goto         observe        act          observe
   │              │            │              │
   ▼              ▼            ▼              ▼
┌──────┐    ┌──────────┐   ┌──────┐    ┌──────────┐
│ Load │───▶│ Agent DOM│──▶│click │───▶│ Agent DOM│──▶ ...
│ page │    │ + IDs    │   │fill  │    │ (updated)│
└──────┘    └──────────┘   └──────┘    └──────────┘
```

1. **`goto`** a URL → page loads, waits for network idle
2. **`observe`** → 4-stage pipeline produces Agent DOM with `agentId` per interactive element
3. **`click`** / **`fill`** using the `agentId` (CDP-native, no selector fragility)
4. **`observe`** again → see the updated state
5. Repeat until done

### How Cheliped Handles What Others Can't

- **Input fields**: Cheliped uses native `HTMLInputElement.value` setters via CDP `Runtime.callFunctionOn`, bypassing React/Vue synthetic event systems. Playwright/Puppeteer type character-by-character, which can conflict with SPA input handlers.
- **WebSquare auto-detection**: Enterprise Korean web frameworks like WebSquare maintain their own internal state model separate from the DOM. Setting `element.value` via DOM doesn't update the framework's state, causing form submissions to fail. Cheliped automatically detects WebSquare on the page (`window.WebSquare`) and calls `comp.setValue()` via the framework's native API — no user intervention needed. All `fill` variants (by agentId, by selector, human-like typing) try WebSquare first, then fall back to DOM methods. This also works as a pattern for other enterprise frameworks with similar widget APIs.
- **Korean IME support**: Text input uses CDP `Input.insertText` instead of `Input.dispatchKeyEvent`, ensuring proper handling of Korean composition (IME) and Unicode characters.
- **CSS selector commands**: `fill-selector`, `click-selector`, and `focus-selector` bypass agentId for direct element targeting. Combined with `type` (character-by-character into focused element) and `press-key` (Enter, Tab, etc.), these enable interaction with any framework widget.
- **Click reliability**: Primary click via CDP `Input.dispatchMouseEvent`, with fallback via `DOM.resolveNode` + `Runtime.callFunctionOn` for elements in complex layouts. No CSS selector construction needed.
- **Same-origin iframes**: Extracts content via `Page.getFrameTree` → `Page.createIsolatedWorld` → `Runtime.evaluate`, merging child frame elements into the main Agent DOM. Other tools require separate frame handling.
- **Link deduplication**: Two-pass algorithm — first finds the best (longest) text for each unique URL, then keeps only the first positional occurrence. Reduces noise on navigation-heavy pages.
- **Heading preservation**: `h1`–`h6` tag identity is preserved through the full pipeline (`tag` field), with deduplication to remove exact-text duplicates. Headings wrapped in links (`<a><h2>...</h2></a>`, common on news sites) also get the `tag` field.
- **Text deduplication**: Removes duplicate text elements from nested containers (e.g. `<td><span>text</span></td>` produces one text entry, not two) while preserving all headings (`h1`–`h6`).

```bash
# Navigate and see what's on the page
node scripts/cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]'

# Interact using agentIds from observe output
node scripts/cheliped-cli.mjs '[{"cmd":"fill","args":["3","hello"]},{"cmd":"click","args":["4"]}]'
```

---

## 📋 Commands

All commands are passed as a JSON array to the CLI:

```bash
node scripts/cheliped-cli.mjs '[{"cmd":"<command>","args":["..."]}]'
```

| Command | Args | What it does |
|:--------|:-----|:-------------|
| `goto` | `["url"]` | Navigate to URL, wait for load |
| `observe` | — | Extract Agent DOM with agentIds |
| `click` | `["agentId"]` | Click an element |
| `fill` | `["agentId", "text"]` | Type into an input field (auto-detects WebSquare) |
| `fill-human` | `["agentId", "text"]` | Human-like char-by-char typing (auto-detects WebSquare) |
| `fill-selector` | `["cssSelector", "text"]` | Fill by CSS selector, bypasses agentId (auto-detects WebSquare) |
| `click-selector` | `["cssSelector"]` | Click by CSS selector, bypasses agentId |
| `focus-selector` | `["cssSelector"]` | Focus element by CSS selector (CDP `DOM.focus`) |
| `type` | `["text"]` | Type into currently focused element (IME-compatible) |
| `press-key` | `["keyName"]` | Press key or combo: Enter, Tab, Escape, `ctrl+a`, `shift+tab`, `ctrl+shift+k` |
| `select` | `["agentId", "value"]` | Select option from `<select>` by text or value |
| `back` | — | Navigate back in browser history |
| `forward` | — | Navigate forward in browser history |
| `hover` | `["agentId"]` | Hover over element (triggers dropdown menus, tooltips) |
| `scroll` | `["direction", "pixels"]` | Scroll page: `up`/`down`/`left`/`right`, default 300px |
| `wait-for` | `["selector", "timeout"]` | Wait for CSS selector to appear (default 5000ms) |
| `screenshot` | `["path"]` | Capture page as PNG |
| `run-js` | `["expr"]` | Execute JS in page context |
| `extract` | `["text"∣"links"∣"all"]` | Pull structured data (text/links use fast path) |
| `actions` | — | Auto-detect semantic actions |
| `perform` | `["actionId"]` | Execute a semantic action |
| `observe-graph` | — | Get UI graph (nodes + edges) |
| `setup-downloads` | `["path"]` | Enable file downloads to specified directory |
| `download` | `["url", "path"]` | Download file by direct URL |
| `download-click` | `["agentId", "path", "timeout"]` | Click element to trigger download |
| `download-js` | `["jsExpr", "path", "timeout"]` | Run JS to trigger download |
| `search` | `["query", "engine"]` | Web search via Chrome — free alternative to search APIs. Engines: `google`, `naver`, `bing`, `duckduckgo`, `baidu`, `yandex`, `yahoo_japan`, `ecosia` |
| `monitor` | `["port"]` | Start real-time browser viewer (default port 19222) |
| `monitor-stop` | — | Stop the monitor viewer |
| `close` | — | Kill Chrome, delete session |

---

## 👁 Real-time Monitor

Watch the agent's browser actions live in a web viewer:

```bash
# Start the monitor — opens in your default browser
node scripts/cheliped-cli.mjs '[{"cmd":"monitor"}]'

# Agent continues working — all actions visible in the viewer
node scripts/cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]'
node scripts/cheliped-cli.mjs '[{"cmd":"fill","args":["3","hello"]},{"cmd":"click","args":["4"]}]'

# Stop the monitor
node scripts/cheliped-cli.mjs '[{"cmd":"monitor-stop"}]'
```

### How it works

The monitor uses CDP [`Page.startScreencast`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast) to stream JPEG frames from Chrome to a lightweight web viewer via Server-Sent Events (SSE).

```mermaid
sequenceDiagram
    participant C as Chrome (headless)
    participant M as Monitor Server (:19222)
    participant V as Browser Viewer

    M->>C: Target.attachToTarget
    M->>C: Page.startScreencast

    loop Every visual change
        C->>M: screencastFrame (JPEG)
        M->>V: SSE data: {frame}
        V->>V: <img> update
        M->>C: screencastFrameAck
    end
```

![Cheliped Monitor — real-time browser viewer](docs/images/monitor-viewer.png)

**Features:**
- Dark-themed compact UI with live/disconnected status indicator
- FPS counter and action bar showing current agent operation
- Auto-opens in default browser on macOS/Linux/Windows
- Zero impact on agent performance — uses separate CDP session via `Target.attachToTarget`
- Auto-closes when Chrome session ends

**Default: off.** Start with `monitor` command when you want to observe the agent's actions.

---

## ⚙️ Configuration

Cheliped's compression settings control the trade-off between **token cost** and **content completeness**.

```javascript
const cheliped = new Cheliped({
  headless: true,
  compression: {
    enabled: true,          // Enable token compression pipeline
    maxTextLength: 200,     // Max characters per text element (default: 200)
    maxTexts: 80,           // Max text elements to keep, headings always kept (default: 80)
    maxLinks: 500,          // Max link elements to keep (default: 5000)
    maxImages: 10,          // Max image elements to keep (default: 10)
    maxListItems: 30,       // Max consecutive same-category items (default: 30)
    excludeEmptyTexts: true,  // Remove empty text elements (default: true)
    deduplicateLinks: true,   // Keep best text per unique URL (default: true)
  },
});
```

### `maxTextLength` — Text Truncation vs Recall

Controls how much of each text element is preserved. Higher values capture more content but increase token cost.

![maxTextLength: Token Cost vs Text Recall](docs/images/config-maxtextlength.png)

| maxTextLength | Avg Tokens | Avg Text Recall | Best For |
|:-------------|----------:|---------------:|:---------|
| 64 | 9,520 | 76.2% | Minimal token budget, navigation-only tasks |
| 128 | 10,103 | 80.7% | Quick page scanning |
| 256 | 10,653 | 81.9% | Balanced for most sites |
| **200** (default) | **~2,000** | **~80%** | **Recommended — good balance** |
| 512 | ~3,000 | 82.9% | Content-heavy pages (Wikipedia, docs) |
| 1024 | 11,212 | 83.6% | Maximum content (reference pages) |
| 2048 | 11,294 | 83.6% | Maximum recall (diminishing returns) |

**Per-site impact:** The effect varies by content density. Wikipedia gains +12% recall going from 64→200, while Hacker News is already 100% at 64.

![Text Recall by Site](docs/images/config-recall-persite.png)

### `maxLinks` — Link Coverage vs Token Budget

Controls how many unique links are included in the Agent DOM.

![maxLinks: Token Cost vs Links Captured](docs/images/config-maxlinks.png)

| maxLinks | Avg Tokens | Avg Links Captured | Best For |
|:---------|----------:|------------------:|:---------|
| 50 | 5,125 | 50 | Minimal output, key navigation only |
| 100 | 6,880 | 97 | Light browsing, simple pages |
| 200 | 8,313 | 143 | Most standard pages |
| **500** (default) | **11,002** | **209** | **Recommended — full page coverage** |
| 1000 | 13,901 | 280 | Reference-heavy pages (docs, wikis) |
| 5000 | 14,186 | 293 | Maximum link capture |

> **Note**: Links are deduplicated by URL before the cap is applied. The actual unique links on a page may be less than `maxLinks`.

### Recommended Presets

```javascript
// Minimal — lowest token cost
{ maxTextLength: 64, maxLinks: 50 }      // ~5,000 tokens avg

// Balanced (default) — good quality/cost ratio
{ maxTextLength: 200, maxTexts: 80, maxLinks: 500 }  // ~2,000 tokens avg

// Maximum — highest recall
{ maxTextLength: 2048, maxLinks: 5000 }  // ~14,000 tokens avg
```

---

## 💡 Examples

### Browse Hacker News

```bash
node scripts/cheliped-cli.mjs '[
  {"cmd":"goto","args":["https://news.ycombinator.com"]},
  {"cmd":"observe"}
]'
```

<details>
<summary>📄 Sample Agent DOM output</summary>

```json
{
  "nodes": [
    { "id": 1, "tag": "a", "text": "Hacker News", "href": "https://news.ycombinator.com" },
    { "id": 2, "tag": "input", "type": "text", "name": "q" },
    { "id": 3, "tag": "button", "text": "Search" }
  ],
  "texts": ["Hacker News", "new | past | comments | ask | show | jobs"],
  "links": [
    { "text": "new", "href": "https://news.ycombinator.com/newest" }
  ]
}
```

</details>

### Login with Semantic Actions

```bash
# Discover what actions are available
node scripts/cheliped-cli.mjs '[
  {"cmd":"goto","args":["https://example.com/login"]},
  {"cmd":"actions"}
]'

# Execute login with parameters
node scripts/cheliped-cli.mjs '[
  {"cmd":"perform","args":["login-form"],"params":{"email":"me@example.com","password":"secret"}}
]'
```

### Take a Screenshot

```bash
node scripts/cheliped-cli.mjs '[
  {"cmd":"goto","args":["https://example.com"]},
  {"cmd":"screenshot","args":["/tmp/page.png"]}
]'
```

### Download a File

```bash
# Direct URL download
node scripts/cheliped-cli.mjs '[
  {"cmd":"download","args":["https://example.com/report.pdf","/tmp/downloads"]}
]'

# Click a download button
node scripts/cheliped-cli.mjs '[
  {"cmd":"observe"},
  {"cmd":"download-click","args":["12","/tmp/downloads","30000"]}
]'
```

### Watch the Agent Work (Real-time Monitor)

```bash
# Start monitor, then run tasks — watch in real-time
node scripts/cheliped-cli.mjs '[{"cmd":"monitor"}]'
node scripts/cheliped-cli.mjs '[{"cmd":"goto","args":["https://news.ycombinator.com"]},{"cmd":"observe"}]'
node scripts/cheliped-cli.mjs '[{"cmd":"click","args":["5"]},{"cmd":"observe"}]'
# Stop when done
node scripts/cheliped-cli.mjs '[{"cmd":"monitor-stop"}]'
```

### Web Search (Free Alternative to Search APIs)

```bash
# Google search
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["AI browser automation","google"]}]'

# Naver search (Korean)
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["브라우저 자동화","naver"]}]'

# DuckDuckGo (most automation-friendly)
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["browser automation","duckduckgo"]}]'

# Baidu (China)
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["浏览器自动化","baidu"]}]'

# Yandex (Russia)
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["browser automation","yandex"]}]'

# Yahoo Japan
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["ブラウザ自動化","yahoo_japan"]}]'

# Ecosia (eco-friendly)
node scripts/cheliped-cli.mjs '[{"cmd":"search","args":["browser automation","ecosia"]}]'
```

<details>
<summary>📄 Sample search output</summary>

```json
{
  "success": true,
  "engine": "google",
  "query": "AI browser automation",
  "results": [
    {
      "title": "Browser Use - The way AI uses the internet",
      "url": "https://browser-use.com/",
      "snippet": "The Way AI uses the web. Agents at scale..."
    },
    {
      "title": "browser-use/browser-use: Make websites accessible for ...",
      "url": "https://github.com/browser-use/browser-use",
      "snippet": "Make websites accessible for AI agents..."
    }
  ]
}
```

</details>

> **Cost comparison**: Google search via Cheliped = **$0** vs WebSearch API = $10/1k queries, Brave = $5/1k, Tavily = $0.8/query. Supports 8 engines: `google`, `naver`, `bing`, `duckduckgo`, `baidu`, `yandex`, `yahoo_japan`, `ecosia`.

### Run Multiple Agents

```bash
# Each agent gets its own Chrome instance
node scripts/cheliped-cli.mjs --session research '[{"cmd":"goto","args":["https://arxiv.org"]}]'
node scripts/cheliped-cli.mjs --session shopping '[{"cmd":"goto","args":["https://amazon.com"]}]'
```

---

## 📊 Full Benchmark Results

> Benchmarked on 16 sites (static, SPA, forms, complex, edge cases) · 2026-03-20 · v0.2.1

### Detailed Comparison — All Tools

#### Architecture

| | Cheliped | Tandem Browser | agent-browser | Playwright | Puppeteer | OpenClaw Browser |
|:--|:---------|:---------------|:--------------|:-----------|:----------|:-----------------|
| **Runtime** | Headless Chrome (spawned) | Electron app (GUI) | Rust binary + Chrome | Node.js + Chromium | Node.js + Chrome | Playwright over Chrome |
| **Protocol** | Direct CDP WebSocket | Electron DevTools → CDP | Direct CDP | CDP via abstraction | CDP via abstraction | Playwright over CDP |
| **API style** | CLI / JS library | HTTP REST API (127.0.0.1:8765) | CLI commands | JS library | JS library | HTTP REST API via gateway |
| **Snapshot method** | Custom DOM pipeline (extract → filter → semantic → compress) | CDP `Accessibility.getFullAXTree()` → compact filter → `@ref` labels | CDP AXTree | `ariaSnapshot()` | `accessibility.snapshot()` | Playwright `ariaSnapshot()` / `_snapshotForAI()` |
| **Human-in-the-loop** | No | Yes (Wingman panel, captcha detection) | No | No | No | No |
| **Security** | Domain allowlist + prompt guard | 6-layer (network, JS AST, behavior) | None | None | None | None |

#### Output Format

**Cheliped (Agent DOM)** — Structured JSON with categorized arrays:
```json
{
  "texts": [{"agentId": 1, "tag": "h1", "text": "Example Domain"}],
  "links": [{"agentId": 2, "text": "Learn more", "href": "https://iana.org/..."}],
  "buttons": [], "inputs": []
}
```

**OpenClaw (AI Snapshot)** — YAML-like accessibility tree with ref tokens:
```yaml
- heading "Example Domain" [level=1] [ref=e3]
- paragraph: This domain is for use in documentation examples...
- link "Learn more" [ref=e6] [cursor=pointer]:
  - /url: https://iana.org/domains/example
```

**Tandem (AXTree Snapshot)** — Indented accessibility tree with `@ref` labels:
```
- WebArea "Example Domain" [@e1]
  - heading "Example Domain" [@e2]
  - paragraph "This domain is for use..." [@e3]
  - link "More information..." [@e4]
```

**Playwright (Aria Snapshot)** — YAML-like flat tree:
```yaml
- heading "Example Domain" [level=1]
- paragraph: This domain is for use in...
- link "More information..."
```

**Puppeteer (Accessibility Snapshot)** — JSON tree with roles:
```json
{"role": "WebArea", "name": "Example Domain", "children": [
  {"role": "heading", "name": "Example Domain", "level": 1},
  {"role": "link", "name": "More information..."}
]}
```

#### Feature Comparison

| Feature | Cheliped | Tandem | agent-browser | Playwright | Puppeteer | OpenClaw |
|:--------|:---------|:-------|:--------------|:-----------|:----------|:---------|
| **Element IDs** | Numeric `agentId` | `@ref` (`@e1`) | None | CSS selectors | CSS selectors | Symbolic `[ref=eN]` |
| **Click/Fill** | By agentId | By @ref | N/A | By locator | By selector | By ref |
| **Human typing** | `fillHuman()` | BehaviorReplay | N/A | N/A | N/A | N/A |
| **Enterprise framework** | WebSquare auto-detect | No | No | No | No | No |
| **Korean IME** | `Input.insertText` | Unknown | No | `type()` | `type()` | No |
| **Content extraction** | Semantic DOM pipeline | Structured by page type | Raw text | A11y tree | A11y tree | YAML a11y tree |
| **Captcha detection** | No | Auto-detect + show | No | No | No | No |
| **Stealth patches** | No | Yes | No | No | No | No |
| **Session isolation** | User data dir | X-Session + partition | No | Browser context | Browser context | Playwright context |
| **Multi-tab** | No | Yes (250+ endpoints) | No | Yes | Yes | Yes |
| **Dialog handling** | No | No | No | Yes | Yes | Yes |
| **File upload** | No | No | No | Yes | Yes | Yes |
| **Cookie CRUD** | No | No | No | Yes | Yes | Yes |
| **JS evaluate** | `runJs()` | `/execute-js` | No | `page.evaluate()` | `page.evaluate()` | Scoped evaluate |
| **Web search** | Built-in (8 engines, $0) | No | No | No | No | No |

#### When to Use Which

| Scenario | Recommended | Why |
|:---------|:-----------|:----|
| **Quick page scan** | Cheliped | Fastest extraction (44ms), fewest tokens (2,588) |
| **Complex SPA interaction** | Playwright | Full auto-wait, robust locator API |
| **Structured data extraction** | Cheliped | Categorized arrays (texts/links/buttons/inputs) are immediately parseable |
| **Lightweight skill integration** | Cheliped | Zero framework deps (ws only), self-contained CLI |
| **Secure human-AI browsing** | Tandem | 6-layer security, captcha detection, human-in-the-loop |
| **Human + AI co-browsing** | Tandem | Wingman panel, persistent messenger panels, shared live workflow |
| **Browser testing / E2E** | Playwright | Mature framework, auto-wait, trace recording |
| **Headless scripting** | Puppeteer | Google-backed, lightweight, well-documented |

### OpenClaw Internal Browser — Separate Comparison

OpenClaw's internal browser runs as an HTTP gateway service (not a standalone library), so it is benchmarked separately against Cheliped.

#### Architecture

| | Cheliped | OpenClaw Browser |
|:--|:---------|:-----------------|
| **Protocol** | Direct CDP WebSocket (raw) | Playwright over CDP |
| **Browser launch** | Self-managed headless Chrome | Attached to running Chrome instance |
| **API style** | CLI JSON commands / JS library | HTTP REST API via gateway |
| **Snapshot method** | Custom DOM pipeline (extract → filter → semantic → compress) | Playwright `ariaSnapshot()` / `_snapshotForAI()` |

#### Output Format

**OpenClaw (AI Snapshot)** — YAML-like accessibility tree with ref tokens:
```yaml
- heading "Example Domain" [level=1] [ref=e3]
- paragraph: This domain is for use in documentation examples...
- link "Learn more" [ref=e6] [cursor=pointer]:
  - /url: https://iana.org/domains/example
```

#### Token Output & Speed

![Cheliped vs OpenClaw: Tokens](docs/images/benchmark-openclaw-tokens.png)

| Site | Cheliped | OpenClaw (full) | OpenClaw (efficient) | Cheliped Speed | OpenClaw Speed |
|:-----|--------:|----------------:|--------------------:|--------------:|--------------:|
| Hacker News | **7,812** | 26,396 | **264** | **13ms** | 1,812ms |
| Wikipedia | **23,104** | 31,656 | 12,177 | **60ms** | 1,219ms |
| GitHub | **6,698** | 8,424 | 2,465 | **21ms** | 1,153ms |
| Example.com | 146 | 188 | **85** | **1ms** | 1,033ms |
| MDN Web Docs | **7,639** | 9,394 | 2,688 | **9ms** | 1,187ms |
| BBC | **4,458** | 24,511 | 7,828 | 370ms | 1,278ms |
| **Average** | **8,310** | **16,762** | **4,251** | **79ms** | **1,280ms** |

![Cheliped vs OpenClaw: Speed](docs/images/benchmark-openclaw-speed.png)

> OpenClaw's efficient mode (`interactive=true` + `compact=true` + `maxDepth=6`) achieves the lowest token count (4,251 avg) by returning only interactive elements. However, it runs 16x slower (1,280ms) due to the Playwright abstraction layer.

### Performance at a Glance

![Benchmark Summary](docs/images/benchmark-summary.png)

![Quality Breakdown](docs/images/benchmark-quality-breakdown.png)

### Strengths

- **2–4x fewer tokens** than all competitors — directly reduces LLM API costs
- **Fastest extraction (44ms avg)** — 2–5x faster than alternatives via direct CDP
- **Best content recognition (88.9%)** — highest recall on links, buttons, inputs, headings
- **Text deduplication** — removes duplicate text elements from nested containers (e.g. `<td><span>`)  while preserving headings
- **Agent DOM** — purpose-built for LLM agents: numbered interactive elements with semantic grouping
- **Zero framework dependencies** — just `ws` for WebSocket, no Playwright/Puppeteer required
- **Same-origin iframe extraction** — merges iframe content into main Agent DOM (CDP-based)
- **Smart link deduplication** — keeps best text per URL, reduces noise on link-heavy pages
- **Fast extract() path** — `extract('text')` and `extract('links')` use lightweight JS evaluation, bypassing the full DOM pipeline (14ms vs 1,100ms+ on heavy pages)
- **React/SPA fill** — native input value setters bypass synthetic event systems
- **WebSquare/enterprise framework support** — auto-detects WebSquare and uses native `setValue()` API to update both DOM and framework internal state. Tested on g2b.go.kr (Korean government procurement)
- **Korean IME input** — `Input.insertText` handles Korean composition correctly, unlike `dispatchKeyEvent`
- **CSS selector commands** — `fill-selector`, `click-selector`, `focus-selector`, `type`, `press-key` for direct element interaction without agentId
- **Session persistence** — Chrome stays alive between agent invocations, no restart overhead
- **Concurrent sessions** — multiple agents browse independently with `--session`

### Known Limitations

Tested on 10 edge-case sites (NPM, Reddit, YouTube, Twitter/X, Google, Stack Overflow, MDN API, W3Schools, JSONPlaceholder, HTTPBin):

- **Cross-origin iframe / Shadow DOM blind spot** — HTTPBin (Swagger UI in cross-origin iframe): buttons 0/11, inputs 0/1, headings 2/13. Same-origin iframes are now extracted, but cross-origin and shadow roots remain invisible. Playwright has the same limitation via ariaSnapshot.
- **Link cap on large pages** — `maxLinks: 5000` but link dedup caps at first occurrence per href. MDN API: 500/1,230 unique links. Configurable but adds tokens.
- **Over-detection on JS-heavy pages** — NPM search: GT reports 2 links (pre-render) but Cheliped finds 105 (post-render). This is actually more accurate, but inflates token count (3,865 tok vs Playwright's 2 tok).
- **Heavy SPA navigation is slow** — Twitter/X, YouTube: all tools are slow on auth-walled SPAs.
- **Heading under-detect on complex pages** — MDN API: 24/52 headings detected (46%). Heading dedup removes duplicates but some unique headings in deeply nested structures are missed. Headings wrapped in links (`<a><h2>...</h2></a>`) are now detected with the `tag` field preserved on the link element.
- **Slow `observe()` on heavy pages** — eBay, CNN, Naver: 1–1.7s due to `DOM.getDocument`. Use `extract('text')` or `extract('links')` for 5–365x faster extraction when full Agent DOM isn't needed.
- **Bot detection** — Amazon, Booking.com serve CAPTCHA to headless Chrome. Use `headless: false` or session cookies.
- **Small SPA token overhead** — TodoMVC (655 tok raw): Cheliped 521 tok vs Puppeteer 388 tok. Structured JSON overhead is minimal on tiny pages.
- **Early-stage project** — not yet battle-tested in production. Playwright and Puppeteer have years of maturity.
- **Benchmark caveats**: token estimation uses `chars/4` (not tiktoken); Playwright/Puppeteer benchmarked via a11y snapshots, not their primary CSS selector APIs.

### Token Efficiency

> **Date**: 2026-03-20 · **Versions**: Cheliped 0.2.1, agent-browser 0.20.14, Playwright 1.58.2, Puppeteer 22.15.0
> **Sites**: Hacker News, Wikipedia, GitHub Trending, Example.com, React TodoMVC (SPA), MDN Web Docs · **Environment**: macOS, Node.js 24, Chrome

| Site | Raw HTML | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|--------:|---------:|--------------:|-----------:|----------:|-------:|
| Hacker News | 8,685 | **2,196** | 15,038 | 9,892 | 4,696 | 14,058 |
| Wikipedia | 123,643 | **2,774** | 39,475 | 15,417 | 19,744 | 37,655 |
| GitHub | 147,484 | 3,363 | 4,026 | 2,275 | **1,505** | 3,849 |
| Example.com | 129 | 92 | 120 | **58** | 71 | 103 |
| React (SPA) | 278 | 601 | 1,016 | 488 | 388 | **154** |
| MDN Web Docs | 17,729 | **2,567** | 11,138 | 5,901 | 3,717 | 7,965 |
| **Average** | **49,658** | **1,932** | **11,802** | **5,672** | **5,020** | **10,631** |

![Tokens per Site](docs/images/benchmark-tokens-per-site.png)

### Speed — DOM Extraction

| Site | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|--------:|--------------:|-----------:|----------:|-------:|
| Hacker News | **19ms** | 215ms | 79ms | 77ms | 49ms |
| Wikipedia | 58ms | 269ms | **67ms** | 144ms | 151ms |
| GitHub | **65ms** | 224ms | 83ms | 92ms | 89ms |
| Example.com | **2ms** | 173ms | 24ms | 22ms | 65ms |
| React (SPA) | **4ms** | 173ms | 33ms | 10ms | 6ms |
| MDN Web Docs | **23ms** | 193ms | 128ms | 30ms | 123ms |
| **Average** | **29ms** | **208ms** | **69ms** | **63ms** | **81ms** |

![Speed per Site](docs/images/benchmark-speed-per-site.png)

### Content Recognition Quality

> Ground truth: actual visible elements collected via Playwright `page.evaluate()` with computed styles.
> Scoring: Text 25% + Link Recall 20% + Link Precision 10% + Button 15% + Input 15% + Heading 15%

#### Ground Truth (what's actually on each page)

| Site | Type | Visible Texts | Links | Buttons | Inputs | Headings |
|:-----|:-----|-------------:|------:|--------:|-------:|---------:|
| Hacker News | Static HTML | 246 | 195 | 0 | 1 | 0 |
| Wikipedia | Static + Forms | 1,370 | 500 | 22 | 14 | 12 |
| GitHub | SPA-like | 1,087 | 45 | 12 | 0 | 14 |
| Example.com | Minimal | 3 | 1 | 0 | 0 | 1 |
| React TodoMVC | React SPA | 23 | 11 | 0 | 1 | 2 |
| MDN Web Docs | Content-heavy | 582 | 354 | 8 | 0 | 10 |

#### Text Recall (% of visible text fragments recognized)

| Site | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|--------:|--------------:|-----------:|----------:|-------:|
| Hacker News | 90.5% | 90.5% | 90.5% | 90.5% | 90.5% |
| Wikipedia | 92.5% | **95.0%** | 90.0% | 90.0% | 90.0% |
| GitHub | **37.0%** | 12.0% | 12.0% | 9.5% | 9.5% |
| Example.com | **100.0%** | **100.0%** | **100.0%** | **100.0%** | **100.0%** |
| React (SPA) | 95.7% | **100.0%** | **100.0%** | **100.0%** | **100.0%** |
| MDN Web Docs | **93.5%** | 69.0% | 69.0% | 68.5% | 68.5% |
| **Average** | **84.9%** | 77.8% | 76.9% | 76.4% | 76.4% |

> Cheliped leads overall with 84.9% avg. Text deduplication removes redundant elements from nested containers while preserving unique content.
> All tools struggle with GitHub — dynamic rendering hides content from all extraction methods.

#### Link Detection

| Site | | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|:--|--------:|--------------:|-----------:|----------:|-------:|
| Hacker News | Recall | **100%** | **100%** | 98% | **100%** | **100%** |
| | Precision | **100%** | **100%** | 88% | 87% | 87% |
| Wikipedia | Recall | 84% | 84% | 84% | 84% | 84% |
| | Precision | 84% | **95%** | **95%** | **95%** | **95%** |
| GitHub | Recall | **100%** | 87% | 84% | 80% | 80% |
| | Precision | 34% | 51% | 49% | 48% | 48% |
| Example.com | Recall | **100%** | **100%** | **100%** | **100%** | **100%** |
| | Precision | **100%** | **100%** | **100%** | **100%** | **100%** |
| React (SPA) | Recall | **100%** | **100%** | **100%** | **100%** | **100%** |
| | Precision | **100%** | **100%** | **100%** | **100%** | **100%** |
| MDN Web Docs | Recall | **100%** | 46% | 46% | 46% | 46% |
| | Precision | **96%** | **100%** | **100%** | **100%** | **100%** |
| **Average** | **Recall** | **97.3%** | 86.1% | 85.5% | 85.0% | 85.0% |
| | **Precision** | 85.6% | **90.9%** | 88.7% | 88.3% | 88.3% |

> Cheliped finds the most links (97.3% recall) but has lower precision on GitHub due to over-detection from expanded link extraction.

#### Button Detection (found / ground-truth buttons)

| Site | Ground Truth | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|:-----------:|--------:|--------------:|-----------:|----------:|-------:|
| Wikipedia | 22 | **21** (95%) | 21 (95%) | 8 (36%) | 3 (14%) | 3 (14%) |
| GitHub | 12 | **11** (92%) | 7 (58%) | 7 (58%) | 2 (17%) | 2 (17%) |
| MDN Web Docs | 8 | **8** (100%) | **8** (100%) | **8** (100%) | 0 (0%) | 0 (0%) |
| **Average** | | **97.9%** | 92.3% | 82.4% | 55.1% | 55.1% |

> Cheliped detects nearly all buttons. Puppeteer and Tandem miss most — their a11y trees often classify buttons differently.

#### Input Field Detection (found / ground-truth inputs)

| Site | Ground Truth | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|:-----------:|--------:|--------------:|-----------:|----------:|-------:|
| Hacker News | 1 | **1** (100%) | 0 (0%) | 0 (0%) | 0 (0%) | 0 (0%) |
| Wikipedia | 14 | **11** (79%) | 1 (7%) | 0 (0%) | 0 (0%) | 0 (0%) |
| React (SPA) | 1 | **1** (100%) | 0 (0%) | 0 (0%) | **1** (100%) | **1** (100%) |
| **Average** | | **79.8%** | 1.2% | 33.3% | 50.0% | 50.0% |

> Cheliped detects the most real input fields overall (79.8%). Wikipedia improved from 1/14 to 11/14 with filter optimizations.
> agent-browser detects 482–1,407 "inputs" per page (false positives from its text format) but matches only 1.2% of real ones.

#### Heading Detection (found / ground-truth headings)

| Site | Ground Truth | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-----|:-----------:|--------:|--------------:|-----------:|----------:|-------:|
| Wikipedia | 12 | 11 (92%) | **12** (100%) | **12** (100%) | 11 (92%) | 11 (92%) |
| GitHub | 14 | **8** (57%) | 4 (29%) | 4 (29%) | 4 (29%) | 4 (29%) |
| Example.com | 1 | **1** (100%) | **1** (100%) | **1** (100%) | **1** (100%) | **1** (100%) |
| React (SPA) | 2 | **2** (100%) | **2** (100%) | **2** (100%) | **2** (100%) | **2** (100%) |
| MDN Web Docs | 10 | **10** (100%) | **10** (100%) | 9 (90%) | **10** (100%) | **10** (100%) |
| **Average** | | **91.5%** | 88.1% | 86.4% | 86.7% | 86.7% |

> Cheliped leads heading detection (91.5%). Text deduplication preserves all headings while removing redundant text elements.

#### Overall Quality Score

| Metric | Weight | Cheliped | agent-browser | Playwright | Puppeteer | Tandem |
|:-------|------:|---------:|--------------:|-----------:|----------:|-------:|
| Text Recall | 25% | **82.0%** | 77.6% | 76.8% | 76.1% | 76.4% |
| Link Recall | 20% | **97.3%** | 86.1% | 85.8% | 85.4% | 85.0% |
| Link Precision | 10% | 85.6% | **90.9%** | 88.9% | 88.5% | 88.3% |
| Button Recall | 15% | **97.9%** | 92.3% | 82.4% | 55.1% | 55.1% |
| Input Recall | 15% | **79.8%** | 1.2% | 33.3% | 50.0% | 50.0% |
| Heading Recall | 15% | **91.5%** | 88.1% | 86.4% | 86.7% | 86.7% |
| **Overall** | **100%** | **88.9%** | **72.9%** | **75.6%** | **73.7%** | **73.7%** |

### Edge Case & Limitation Test

> Tested on 10 additional sites targeting known weaknesses: long lists, heavy SPAs, forms, complex structure, iframes.

#### Navigation & Extraction

| Site | Category | Cheliped | Playwright | Puppeteer | Tandem | Notes |
|:-----|:---------|--------:|----------:|----------:|-------:|:------|
| NPM Search | Long List | 3,935 tok / 9ms | 2 tok / 24ms | 44 tok / 24ms | 10 tok / 18ms | Cheliped extracts post-render content (112 links); others see pre-render |
| Reddit | Long List | 8,575 tok / 14ms | 65 tok / 20ms | 223 tok / 35ms | 142 tok / 42ms | Similar: Cheliped renders fully, outputs more |
| YouTube | Heavy SPA | 561 tok / 45ms | 34 tok / 37ms | 1,685 tok / 11ms | 162 tok / 7ms | All limited by consent/auth wall |
| Twitter/X | Heavy SPA | 72 tok / 5ms | 22 tok / 279ms | 67 tok / 41ms | 32 tok / 50ms | Login wall — all tools see minimal content |
| Google Search | Forms | 627 tok / 12ms | 350 tok / 33ms | 898 tok / 12ms | 480 tok / 24ms | Cheliped finds 7 inputs vs GT 1 (hidden inputs exposed) |
| Stack Overflow | Forms | 1,623 tok / 16ms | 2 tok / 16ms | 44 tok / 17ms | 10 tok / 18ms | Login required — Cheliped extracts nav elements |
| MDN API | Complex | 20,428 tok / 54ms | 45,601 tok / 121ms | 116,440 tok / 194ms | 86,600 tok / 200ms | 1,230 links, Cheliped dedup caps at ~500 |
| W3Schools | Complex | 11,325 tok / 32ms | 5,763 tok / 32ms | 20,414 tok / 29ms | 13,003 tok / 22ms | Cheliped headings 44 vs 29 GT (slight over-detect) |
| JSONPlaceholder | Minimal | 1,356 tok / 3ms | 1,360 tok / 19ms | 3,980 tok / 7ms | 2,502 tok / 5ms | Near-identical with Playwright |
| HTTPBin | Minimal | 249 tok / 2ms | 175 tok / 13ms | 833 tok / 2ms | 563 tok / 5ms | Swagger UI in cross-origin iframe — all tools miss buttons/inputs |

#### Element Detection Accuracy (Cheliped vs Ground Truth)

| Site | Links | Buttons | Inputs | Headings | Verdict |
|:-----|------:|--------:|-------:|---------:|:--------|
| NPM Search | 106/2 | 2/0 | 2/0 | 26/2 | Over-detect (post-render vs pre-render GT) |
| Reddit | 195/1 | 50/0 | 29/0 | 2/0 | Over-detect (same reason) |
| YouTube | 10/6 | 12/6 | **1/1** | 1/0 | Good input detection, some over-detect |
| Twitter/X | 0/0 | **1/1** | 1/0 | 0/0 | Minimal content (auth wall) |
| Google | **11/11** | 11/7 | 7/1 | 0/0 | Perfect link recall, hidden inputs exposed |
| Stack Overflow | 2/2 | 0/0 | 1/0 | 2/2 | Accurate |
| MDN API | 500/1230 | **9/8** | 0/0 | 24/52 | Link dedup caps at ~500, heading 46% |
| W3Schools | 317/241 | 27/10 | **25/16** | 44/29 | Input recall good, heading slight over-detect |
| JSONPlaceholder | 25/29 | **1/1** | 0/0 | **8/8** | Accurate |
| HTTPBin | 5/15 | 0/11 | 0/1 | 2/13 | Cross-origin iframe blind spot (Swagger UI) |

#### Key Findings

1. **Cross-origin iframe is a real blind spot** — HTTPBin's Swagger UI (cross-origin iframe) is invisible to all tools. Cheliped now extracts same-origin iframes, but cross-origin remains blocked by browser security.
2. **Post-render extraction is a double-edged sword** — Cheliped's CDP approach renders JS fully (NPM: 105 links vs GT's 2), which is more accurate but inflates tokens.
3. **Smart link dedup reduces noise** — MDN API has 1,230 links; Cheliped's two-pass dedup returns ~500 unique URLs with best text. Configurable via options.
4. **Heavy SPAs are equally hard for everyone** — YouTube/Twitter extraction is slow and content-limited for all tools.
5. **Form detection advantage holds** — Even on edge cases, Cheliped finds more real inputs (Google: 7, W3Schools: 25) than competitors.
6. **Heading dedup improves accuracy** — W3Schools headings reduced from over-detect to near-accurate (36 vs 29 GT). MDN improved from 4 to 27/52.

### Challenge Benchmark — Complex Real-World Sites

> Tested on 14 challenging sites: e-commerce, news portals, web apps, deeply nested pages, complex forms, international, documentation.

#### Token Output & Observe Speed

| Site | Category | Cheliped | Playwright | Puppeteer | Tandem |
|:-----|:---------|--------:|----------:|----------:|-------:|
| Amazon | E-commerce | 57,079 tok / 131ms | 34,288 tok / 129ms | 34,886 tok / 94ms | 19,464 tok / 79ms |
| eBay | E-commerce | 33,615 tok / 117ms | 77 tok / 13ms | 352 tok / 4ms | 172 tok / 3ms |
| CNN | News Portal | 11,302 tok / 258ms | 16,017 tok / 70ms | 27,177 tok / 71ms | 29,711 tok / 61ms |
| BBC | News Portal | 3,988 tok / 69ms | 8,397 tok / 198ms | 19,987 tok / 88ms | 17,970 tok / 102ms |
| GitHub Issues | Web App | 9,465 tok / 74ms | 3,017 tok / 187ms | 11,386 tok / 203ms | 11,750 tok / 186ms |
| GitLab Explore | Web App | 905 tok / 6ms | 440 tok / 47ms | 1,440 tok / 23ms | 1,021 tok / 28ms |
| HN Comment Thread | Deep Nesting | 817 tok / 4ms | 1,041 tok / 14ms | 1,881 tok / 4ms | 1,368 tok / 5ms |
| Wikipedia (Long) | Deep Nesting | 17,051 tok / 34ms | 21,198 tok / 46ms | 66,468 tok / 58ms | 49,859 tok / 54ms |
| Booking.com | Complex Form | 60 tok / 4ms | 0 tok / 14ms | 33 tok / 2ms | 0 tok / 13ms |
| Zillow | Complex Form | 11,108 tok / 18ms | ❌ | 32 tok / 4ms | 15 tok / 10ms |
| Naver | International | 5,430 tok / 433ms | 152 tok / 21ms | 774 tok / 8ms | 354 tok / 15ms |
| Baidu | International | 2,459 tok / 29ms | 1,121 tok / 15ms | 2,183 tok / 21ms | 1,371 tok / 6ms |
| Rust Docs | Documentation | 12,564 tok / 12ms | 11,958 tok / 41ms | 33,673 tok / 61ms | 21,154 tok / 39ms |
| React Docs | Documentation | 2,314 tok / 8ms | 2,829 tok / 43ms | 5,137 tok / 19ms | 3,877 tok / 25ms |

#### Fast Extract vs Full Observe (Cheliped only)

On heavy pages where `observe()` is slow, `extract('text')` and `extract('links')` bypass the full DOM pipeline:

| Site | observe() | extract(text) | extract(links) | Speedup |
|:-----|----------:|--------------:|---------------:|--------:|
| eBay | 268ms | 22ms | 6ms | **12–45x** |
| CNN | 290ms | 18ms | 11ms | **16–26x** |
| Naver | 965ms | 7ms | 3ms | **138–322x** |
| Zillow | 363ms | 14ms | 39ms | **9–26x** |
| BBC | 47ms | 5ms | 3ms | 9–16x |
| Wikipedia (Long) | 119ms | 10ms | 15ms | 8–12x |

#### Element Detection (Cheliped vs Ground Truth)

| Site | Links | Buttons | Inputs | Headings | Notes |
|:-----|------:|--------:|-------:|---------:|:------|
| Amazon | 461/484 | 124/72 | 205/241 | 57/55 | Full page access (no CAPTCHA this run) |
| eBay | 375/344 | 69/56 | 15/72 | 29/21 | Post-render over-detect |
| CNN | 235/295 | 16/5 | 11/1 | 18/16 | Good recall |
| BBC | 88/107 | 20/10 | 1/0 | **45/60** | Heading-in-link fix preserves headings |
| GitHub Issues | 159/142 | 30/19 | 10/1 | 32/30 | Good recall on dynamic page |
| GitLab Explore | 23/180 | 15/44 | 1/1 | 2/2 | Auth-limited content |
| HN Comment Thread | **25/25** | 0/0 | **1/1** | 0/0 | Perfect |
| Wikipedia (Long) | 500/869 | 14/6 | 4/14 | 1/28 | Link cap at 500 |
| Booking.com | 0/135 | 0/13 | 0/2 | 0/17 | Bot detection (all tools fail) |
| Zillow | 258/0 | 13/0 | 4/0 | 2/0 | Post-render (GT sees empty pre-JS page) |
| Naver | 94/157 | 17/19 | 17/1 | 5/5 | Good, speed is the issue |
| Baidu | 50/29 | 1/1 | 17/1 | 0/0 | Input over-detect (hidden inputs) |
| Rust Docs | 247/317 | 3/2 | 1/0 | **18/17** | Link dedup caps, heading accurate |
| React Docs | 56/74 | 6/3 | 0/0 | 12/15 | Good recall |

#### Key Findings

1. **Bot detection is the real blocker** — Booking.com serves CAPTCHA pages to headless Chrome. All tools fail equally. Use `headless: false` or session cookies for these sites.
2. **`observe()` is slow on heavy pages, `extract()` is fast** — Naver (965ms observe → 7ms extract), CNN (290ms → 18ms), eBay (268ms → 22ms). When full Agent DOM isn't needed, use `extract('text')` or `extract('links')` for 8–322x speedup.
3. **Heading-in-link pattern fixed** — BBC's article headlines (`<a><h2>Title</h2></a>`) are now detected. Headings inside links get the `tag` field preserved on the link element (45/60 headings, 75% recall).
4. **Token efficiency wins on content-heavy pages** — BBC 4,226 vs Puppeteer 20,089 (4.8x), Wikipedia 16,893 vs Puppeteer 66,468 (3.9x), React Docs 2,260 vs Puppeteer 5,137 (2.3x).
5. **Text deduplication reduces noise** — Removes duplicate text elements from nested containers (e.g. `<td><span>text</span></td>`) while preserving all headings.

<details>
<summary>🔧 Run the benchmarks yourself</summary>

```bash
cd scripts
npm install
npm run build
node benchmark-compare.mjs      # Token efficiency & speed (6 sites)
node benchmark-quality.mjs      # Content recognition quality (6 sites)
node benchmark-limitations.mjs  # Edge cases & limitations (10 sites)
node benchmark-challenge.mjs    # Challenge benchmark (14 complex sites)
node benchmark.mjs              # Full benchmark with search (5 sites + 8 engines)
```

</details>

### Search Benchmark — Free Alternative to Search APIs

> Tested 8 search engines with structured result extraction via Chrome · 2026-03-20

| Engine | Country | Results | Time | Tokens | API Cost Saved |
|:-------|:--------|--------:|-----:|-------:|:---------------|
| Google | Global | 9 | 1.5s | 655 | $10/1k (WebSearch) |
| Naver | Korea | 20 | 2.5s | 673 | N/A |
| Bing | Global | 10 | 30.2s | 682 | $5/1k (Brave) |
| DuckDuckGo | Global | 10 | 2.4s | 708 | $0.8/query (Tavily) |
| Baidu | China | 14 | 5.2s | 2,833 | N/A |
| Yandex | Russia | 14 | 31.5s | 699 | N/A |
| Yahoo Japan | Japan | 10 | 2.4s | 625 | N/A |
| Ecosia | Europe | 10 | 35.6s | 715 | N/A |

**Summary**: Avg **12.1 results/query** · **949 tokens/query** · **$0 cost** vs $5-10/1k with paid APIs

> **Trade-off**: Search via Chrome is slower than API calls (1-35s vs 200-500ms) but completely free. Best suited for AI agents that search occasionally, not bulk SERP scraping. Google/Naver/DuckDuckGo/Yahoo Japan are fastest (~2s); Bing/Yandex/Ecosia are slower (~30s).

---

## 🛠 Development

```bash
cd scripts
npm install           # Install dependencies
npm run build         # Build TypeScript → dist/
npm test              # Run unit tests
npm run test:integration  # Integration tests (needs Chrome)
```

---

## ⭐ Star History

<a href="https://star-history.com/#tykimos/cheliped-browser&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tykimos/cheliped-browser&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tykimos/cheliped-browser&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=tykimos/cheliped-browser&type=Date" />
 </picture>
</a>

---

## 🤝 Contributing

Contributions are welcome! Feel free to open an [issue](https://github.com/tykimos/cheliped-browser/issues) or submit a [pull request](https://github.com/tykimos/cheliped-browser/pulls).

---

## 📜 License

MIT — do whatever you want with it.

---

<div align="center">

**Built for agents that need to see the web.** 🦀

[Report a Bug](https://github.com/tykimos/cheliped-browser/issues) · [Request a Feature](https://github.com/tykimos/cheliped-browser/issues)

</div>
