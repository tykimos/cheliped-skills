# Changelog

## v0.3.0 (2026-03-27)

### New Feature: Iframe Interaction Support

Regular `observe`/`click` cannot interact with elements inside iframes (e.g. Cloudflare Turnstile CAPTCHA, embedded widgets, third-party login forms). This release adds a complete iframe interaction layer with 5 new commands.

#### `list-frames` — Discover All Iframes
List all child frames on the current page with their URL, name, and index.

```bash
node cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"list-frames"}]'
# Returns: { frames: [{ index: 0, url: "https://...", name: "...", frameId: "..." }] }
```

#### `observe-frame` — Observe Elements Inside an Iframe
Extract all visible interactive elements inside a specific iframe, with CSS selectors for targeting.

```bash
# By index (from list-frames output)
node cheliped-cli.mjs '[{"cmd":"observe-frame","args":["0"]}]'

# By URL substring match
node cheliped-cli.mjs '[{"cmd":"observe-frame","args":["turnstile"]}]'
```

- Returns elements with `index`, `tag`, `text`, `selector`, `attributes`
- Filters out invisible elements (display:none, visibility:hidden, zero-size)
- Generates unique CSS selectors (by id, name, class, or nth-of-type)

#### `click-frame` — Click Inside an Iframe
Click an element inside an iframe using **absolute coordinate dispatch** — computes iframe position + element position for real mouse events.

```bash
# Click Cloudflare Turnstile checkbox
node cheliped-cli.mjs '[{"cmd":"click-frame","args":["turnstile","input[type=checkbox]"]}]'

# Click by frame index
node cheliped-cli.mjs '[{"cmd":"click-frame","args":["0","button.submit"]}]'
```

- Dispatches `mouseMoved` → `mousePressed` → `mouseReleased` via CDP `Input.dispatchMouseEvent`
- Human-like random delay (50-130ms) between move and click
- Passes bot detection by producing real browser-level mouse events

#### `fill-frame` — Type Into Iframe Inputs
Fill an input field inside an iframe with human-like character-by-character typing.

```bash
node cheliped-cli.mjs '[{"cmd":"fill-frame","args":["0","input[name=email]","user@example.com"]}]'
```

- Clears existing value, clicks to focus, then types via `Input.insertText`
- Random delay (50-150ms) per character
- Dispatches `input` + `change` events for framework reactivity

#### `run-js-frame` — Execute JavaScript in Iframe Context
Run arbitrary JavaScript inside an iframe's execution context.

```bash
node cheliped-cli.mjs '[{"cmd":"run-js-frame","args":["0","document.title"]}]'
```

### New Feature: Shadow DOM Interaction Support

Elements inside shadow DOM (e.g. Cloudflare Turnstile, web components) are invisible to regular CSS selectors. This release adds shadow-piercing commands.

#### `observe-shadow` — Discover Shadow DOM Hosts
Find all elements with shadow roots and list their interactive content and embedded iframes.

```bash
node cheliped-cli.mjs '[{"cmd":"observe-shadow"}]'
# Returns: { shadowHosts: [{ hostSelector, elements: [...], iframes: [...] }], count }
```

#### `click-deep` — Shadow-Piercing Click
Click any element, automatically traversing shadow DOM boundaries. Uses `>>>` syntax for explicit shadow root crossing.

```bash
# Auto-search all shadow roots recursively
node cheliped-cli.mjs '[{"cmd":"click-deep","args":["input[type=checkbox]"]}]'

# Explicit path: host >>> inner selector
node cheliped-cli.mjs '[{"cmd":"click-deep","args":["#turnstile-widget >>> input[type=checkbox]"]}]'
```

- Resolves element via JS-based recursive shadow root traversal
- Gets bounding rect and dispatches real `mouseMoved` → `mousePressed` → `mouseReleased` events
- Human-like random delay between move and click
- Fallback to JS `.click()` for zero-size elements

#### `fill-deep` — Shadow-Piercing Fill
Type into input fields inside shadow DOM with human-like character-by-character typing.

```bash
node cheliped-cli.mjs '[{"cmd":"fill-deep","args":["#shadow-host >>> input[name=email]","user@example.com"]}]'
```

### Enhanced: `list-frames` Now Discovers Shadow DOM Iframes

`list-frames` now also scans shadow DOM for hidden iframes that `Page.getFrameTree` may miss. This catches dynamically injected iframes (e.g. Cloudflare Turnstile's challenge iframe inside a shadow root).

### Architecture: FrameManager

New `FrameManager` class (`src/browser/frame-manager.ts`) handles:

1. **Frame discovery** — `Page.getFrameTree` to enumerate all child frames
2. **Context management** — `Page.createIsolatedWorld` with caching and auto-revalidation
3. **Frame resolution** — flexible targeting by index (number) or URL/name substring
4. **Coordinate translation** — locates iframe element via `DOM.describeNode` + `DOM.getBoxModel`, then adds element offset within iframe for absolute page coordinates
5. **Cache invalidation** — automatically cleared on navigation (`resetFrameworkCache`)

### Files Changed

| File | Change |
|:-----|:-------|
| `src/browser/frame-manager.ts` | **New** — `FrameManager` class (iframe discovery, context, coordinate translation, interactions) |
| `src/browser/controller.ts` | +5 iframe methods + 3 shadow DOM methods (`clickDeep`, `fillDeep`, `observeShadow`) |
| `src/browser/index.ts` | Export `FrameManager` and `FrameDetail` type |
| `src/api/cheliped.ts` | +5 iframe APIs + 3 shadow DOM APIs (`observeShadow`, `clickDeep`, `fillDeep`) |
| `src/index.ts` | Export `FrameManager` and `FrameDetail` type |
| `cheliped-cli.mjs` | +8 CLI commands: iframe (5) + shadow DOM (3: `observe-shadow`, `click-deep`, `fill-deep`) |
| `SKILL.md` | Iframe + shadow DOM commands documented with examples |

---

## v0.2.2 (2026-03-23)

### New Commands

#### `back` / `forward` — Browser History Navigation
Navigate back and forward through browser history without re-entering URLs.

```bash
# Visit two pages, then go back
node cheliped-cli.mjs '[{"cmd":"goto","args":["https://page-a.com"]},{"cmd":"goto","args":["https://page-b.com"]},{"cmd":"back"}]'

# Go forward again
node cheliped-cli.mjs '[{"cmd":"forward"}]'
```

- Uses CDP `Page.getNavigationHistory` + `Page.navigateToHistoryEntry` for reliable navigation
- Automatically resets framework detection cache on navigation
- No-op when already at the start/end of history (does not throw)

#### `hover` — Hover Over Elements
Hover over elements by agentId. Triggers dropdown menus, tooltips, and hover-dependent UI.

```bash
# Observe page, then hover over element 5
node cheliped-cli.mjs '[{"cmd":"observe"},{"cmd":"hover","args":["5"]}]'
```

- Dispatches real `mouseMoved` CDP events at element center coordinates
- Fallback: `mouseover` + `mouseenter` JS events for hidden/zero-size elements
- Enables interaction with CSS `:hover` menus without clicking

#### `scroll` — Directional Page Scrolling
Pixel-level page scrolling in any direction. Essential for infinite-scroll pages and content below the fold.

```bash
# Scroll down 500px
node cheliped-cli.mjs '[{"cmd":"scroll","args":["down","500"]}]'

# Scroll up with default 300px
node cheliped-cli.mjs '[{"cmd":"scroll","args":["up"]}]'

# Horizontal scroll
node cheliped-cli.mjs '[{"cmd":"scroll","args":["right","200"]}]'
```

- Directions: `up`, `down`, `left`, `right`
- Default: 300px per scroll
- Uses CDP `Input.dispatchMouseEvent` with `mouseWheel` type
- 200ms settle delay after each scroll

#### `wait-for` — Wait for CSS Selector
Wait for a CSS selector to appear in the DOM with configurable timeout. Critical for SPA apps with async rendering.

```bash
# Wait for element to appear (default 5s timeout)
node cheliped-cli.mjs '[{"cmd":"wait-for","args":["#search-results"]}]'

# Custom timeout (10s)
node cheliped-cli.mjs '[{"cmd":"wait-for","args":[".loaded-content","10000"]}]'
```

- Polls every 200ms until found or timeout
- Returns `{ found: true/false, selector: "..." }`
- Default timeout: 5000ms
- Does not throw on timeout — returns `found: false`

### Enhancements

#### Keyboard Combinations
`press-key` now supports modifier combos with `+` syntax.

```bash
# Select all text
node cheliped-cli.mjs '[{"cmd":"press-key","args":["ctrl+a"]}]'

# Shift+Tab (reverse tab)
node cheliped-cli.mjs '[{"cmd":"press-key","args":["shift+tab"]}]'

# Triple modifier
node cheliped-cli.mjs '[{"cmd":"press-key","args":["ctrl+shift+k"]}]'

# Mac Command key
node cheliped-cli.mjs '[{"cmd":"press-key","args":["meta+c"]}]'
```

- Supported modifiers: `ctrl` / `control`, `shift`, `alt`, `meta` / `cmd` / `command`
- Works with all existing keys (Enter, Tab, arrows, etc.) and single characters (a-z, 0-9)
- Uses CDP `modifiers` bitmask for proper OS-level key events

### Testing

- **19 new integration tests** covering all new features
- **Test fixture page** (`tests/fixtures/test-features.html`) with hover menus, scroll markers, keyboard logging, delayed content, and navigation links
- **5 pre-existing test failures fixed** — tests now match current design:
  - Empty arrays omitted for token efficiency (TOK-1)
  - Low-confidence actions (open_link: 0.3, click_button: 0.4) correctly filtered by 0.7 threshold
- **Final results**: Unit 107/107, Integration 30/30

### Files Changed

| File | Change |
|:-----|:-------|
| `src/browser/controller.ts` | +5 methods: `goBack`, `goForward`, `hoverByBackendNodeId`, `scroll`, `waitForSelector`. Extended `pressKey` with modifier combo parsing |
| `src/api/cheliped.ts` | +5 public APIs: `goBack`, `goForward`, `hover`, `scroll`, `waitForSelector` |
| `src/types/api.types.ts` | Extended `ActResult.action` union with `back`, `forward`, `hover`, `scroll` |
| `cheliped-cli.mjs` | +5 CLI commands: `back`, `forward`, `hover`, `scroll`, `wait-for` |
| `SKILL.md` | Updated command table |
| `README.md` | Updated command table |
| `tests/fixtures/test-features.html` | New test page |
| `tests/integration/new-features.test.ts` | 19 new tests |

---

## v0.1.0

Initial release with core Agent DOM pipeline, observe-act loop, semantic actions, web search, real-time monitor, and download support.
