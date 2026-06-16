import { join } from 'path';
import type { GotoResult } from '../types/index.js';
import type { DownloadResult } from '../types/api.types.js';
import type { CDPTransport } from '../cdp/transport.js';
import { Page } from './page.js';
import { FrameManager } from './frame-manager.js';
import type { FrameDetail } from './frame-manager.js';

export class BrowserController {
  private page: Page;
  private _webSquareDetected: boolean | null = null;
  private _frameManager: FrameManager;

  constructor(private transport: CDPTransport) {
    this.page = new Page(transport);
    this._frameManager = new FrameManager(transport);
  }

  /**
   * Detect whether the current page uses WebSquare framework.
   * Result is cached per page navigation.
   */
  private async detectWebSquare(): Promise<boolean> {
    if (this._webSquareDetected !== null) return this._webSquareDetected;
    try {
      const result = await this.transport.send('Runtime.evaluate', {
        expression: `typeof window.WebSquare !== 'undefined' && typeof WebSquare.util?.getComponentById === 'function'`,
        returnByValue: true,
      }) as Record<string, unknown>;
      const r = result.result as Record<string, unknown>;
      this._webSquareDetected = r?.value === true;
    } catch {
      this._webSquareDetected = false;
    }
    return this._webSquareDetected;
  }

  /** Reset WebSquare detection cache (called on navigation). */
  resetFrameworkCache(): void {
    this._webSquareDetected = null;
    this._frameManager.clearCache();
  }

  // ── Frame (iframe) methods ──

  /** List all child frames on the current page. */
  async listFrames(): Promise<FrameDetail[]> {
    return this._frameManager.listFrames();
  }

  /** Observe interactive elements inside a specific iframe. */
  async observeFrame(target: string | number): Promise<unknown> {
    const frameId = await this._frameManager.resolveFrame(target);
    return this._frameManager.observeFrame(frameId);
  }

  /** Click an element inside an iframe by CSS selector. Uses absolute coordinate dispatch. */
  async clickInFrame(target: string | number, selector: string): Promise<void> {
    const frameId = await this._frameManager.resolveFrame(target);
    await this._frameManager.clickInFrame(frameId, selector);
  }

  /** Fill an input inside an iframe by CSS selector. Uses coordinate click + Input.insertText. */
  async fillInFrame(target: string | number, selector: string, text: string): Promise<void> {
    const frameId = await this._frameManager.resolveFrame(target);
    await this._frameManager.fillInFrame(frameId, selector, text);
  }

  /** Run JavaScript inside an iframe. */
  async runJsInFrame(target: string | number, expression: string): Promise<unknown> {
    const frameId = await this._frameManager.resolveFrame(target);
    return this._frameManager.evaluateInFrame(frameId, expression);
  }

  // ── Shadow DOM methods ──

  /**
   * Deep querySelector that pierces shadow DOM boundaries.
   * Uses JS to recursively traverse shadowRoots.
   * Selector format: "host-selector >>> inner-selector" or plain CSS selector.
   */
  private async deepQuery(selector: string): Promise<{ objectId: string; backendNodeId: number }> {
    const result = await this.transport.send('Runtime.evaluate', {
      expression: `(function() {
        function deepQuery(root, selector) {
          // Try direct match first
          var el = root.querySelector(selector);
          if (el) return el;
          // Traverse shadow roots
          var all = root.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) {
              var found = deepQuery(all[i].shadowRoot, selector);
              if (found) return found;
            }
          }
          return null;
        }
        var parts = ${JSON.stringify(selector)}.split('>>>').map(function(s) { return s.trim(); });
        var current = document;
        for (var p = 0; p < parts.length; p++) {
          var sel = parts[p];
          if (p === parts.length - 1) {
            // Last segment: use deep search from current context
            var found = (current === document) ? deepQuery(document, sel) : deepQuery(current, sel);
            return found ? true : null;
          } else {
            // Intermediate segment: find host and enter its shadow root
            var host = (current === document) ? document.querySelector(sel) : current.querySelector(sel);
            if (!host) return null;
            if (!host.shadowRoot) return null;
            current = host.shadowRoot;
          }
        }
        return null;
      })()`,
      returnByValue: true,
    }) as Record<string, unknown>;

    // We need the element as a RemoteObject, not by value.
    // Re-run returning the element reference.
    const refResult = await this.transport.send('Runtime.evaluate', {
      expression: `(function() {
        function deepQuery(root, selector) {
          var el = root.querySelector(selector);
          if (el) return el;
          var all = root.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) {
              var found = deepQuery(all[i].shadowRoot, selector);
              if (found) return found;
            }
          }
          return null;
        }
        var parts = ${JSON.stringify(selector)}.split('>>>').map(function(s) { return s.trim(); });
        var current = document;
        for (var p = 0; p < parts.length; p++) {
          var sel = parts[p];
          if (p === parts.length - 1) {
            return (current === document) ? deepQuery(document, sel) : deepQuery(current, sel);
          } else {
            var host = (current === document) ? document.querySelector(sel) : current.querySelector(sel);
            if (!host || !host.shadowRoot) return null;
            current = host.shadowRoot;
          }
        }
        return null;
      })()`,
      returnByValue: false,
    }) as Record<string, unknown>;

    const obj = refResult.result as Record<string, unknown>;
    if (!obj?.objectId || obj.subtype === 'null') {
      throw new Error(`Element not found (deep query): ${selector}`);
    }

    const objectId = obj.objectId as string;

    // Get backendNodeId via DOM.describeNode
    let backendNodeId = -1;
    try {
      const descResult = await this.transport.send('DOM.requestNode', {
        objectId,
      }) as { nodeId: number };
      if (descResult.nodeId) {
        const desc = await this.transport.send('DOM.describeNode', {
          nodeId: descResult.nodeId,
        }) as { node: { backendNodeId: number } };
        backendNodeId = desc.node.backendNodeId;
      }
    } catch {
      // backendNodeId remains -1 for elements that can't be described
    }

    return { objectId, backendNodeId };
  }

  /**
   * Click an element using shadow-piercing deep query.
   * Selector supports ">>>" to pierce shadow DOM boundaries.
   * Example: "#turnstile-widget >>> input[type=checkbox]"
   */
  async clickDeep(selector: string): Promise<void> {
    const { objectId } = await this.deepQuery(selector);

    // Get bounding rect via JS on the RemoteObject
    const rectResult = await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.scrollIntoView({ block: 'center', inline: 'center' });
        var r = this.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }`,
      returnByValue: true,
    }) as { result?: { value?: { x: number; y: number; width: number; height: number } } };

    const rect = rectResult.result?.value;
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      // Fallback: JS click
      await this.transport.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.click(); }`,
        returnByValue: true,
      });
      await this.page.waitForStable();
      return;
    }

    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;

    // Human-like: move → pause → press → release
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y,
    });
    await new Promise(r => setTimeout(r, 30 + Math.floor(Math.random() * 60)));
    await this._dispatchClick(x, y);
    await this.page.waitForStable();
  }

  /**
   * Fill an input using shadow-piercing deep query.
   * Selector supports ">>>" to pierce shadow DOM boundaries.
   */
  async fillDeep(selector: string, text: string): Promise<void> {
    const { objectId } = await this.deepQuery(selector);

    // Clear and focus
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.scrollIntoView({ block: 'center' });
        if ('value' in this) this.value = '';
        this.focus();
      }`,
      returnByValue: true,
    });

    // Click to activate
    const rectResult = await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        var r = this.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }`,
      returnByValue: true,
    }) as { result?: { value?: { x: number; y: number } } };

    const pos = rectResult.result?.value;
    if (pos && (pos.x !== 0 || pos.y !== 0)) {
      await this._dispatchClick(pos.x, pos.y);
    }

    // Type character by character
    for (const char of text) {
      await this.transport.send('Input.insertText', { text: char });
      await new Promise(r => setTimeout(r, 50 + Math.floor(Math.random() * 100)));
    }

    // Dispatch events
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      returnByValue: true,
    });
  }

  /**
   * Observe shadow DOM: find all shadow hosts and their interactive content.
   * Returns shadow hosts with their inner elements.
   */
  async observeShadow(): Promise<unknown> {
    const result = await this.transport.send('Runtime.evaluate', {
      expression: `(function() {
        var hosts = [];
        function findShadowHosts(root, depth) {
          if (depth > 5) return;
          var all = root.querySelectorAll('*');
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.shadowRoot) {
              var iframes = Array.from(el.shadowRoot.querySelectorAll('iframe')).map(function(f) {
                return { src: f.src, name: f.name, id: f.id };
              });
              var SELECTORS = 'button, input, select, textarea, a[href], [role="button"], [role="checkbox"], [role="link"], [tabindex], label';
              var elements = Array.from(el.shadowRoot.querySelectorAll(SELECTORS)).filter(function(e) {
                var r = e.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return false;
                var s = window.getComputedStyle(e);
                return s.display !== 'none' && s.visibility !== 'hidden';
              }).map(function(e, idx) {
                var sel = '';
                if (e.id) sel = '#' + e.id;
                else if (e.className && typeof e.className === 'string') sel = e.tagName.toLowerCase() + '.' + e.className.trim().split(/\\s+/)[0];
                else sel = e.tagName.toLowerCase();
                var attrs = {};
                for (var a of e.attributes) attrs[a.name] = a.value;
                return {
                  index: idx,
                  tag: e.tagName.toLowerCase(),
                  type: e.type || undefined,
                  text: (e.textContent || '').trim().slice(0, 200),
                  selector: sel,
                  attributes: attrs,
                  rect: (function() { var r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
                };
              });
              var hostId = el.id || el.tagName.toLowerCase();
              var hostClasses = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
              hosts.push({
                hostSelector: el.id ? '#' + el.id : el.tagName.toLowerCase() + hostClasses,
                hostTag: el.tagName.toLowerCase(),
                elements: elements,
                iframes: iframes,
              });
              // Recurse into nested shadow roots
              findShadowHosts(el.shadowRoot, depth + 1);
            }
          }
        }
        findShadowHosts(document, 0);
        return { shadowHosts: hosts, count: hosts.length };
      })()`,
      returnByValue: true,
    }) as { result?: { value?: unknown } };

    return result?.result?.value;
  }

  /**
   * Try to set value via WebSquare component API.
   * Finds the component by element id or parent id, then calls setValue().
   * Returns true if successful, false if WebSquare is not available or component not found.
   */
  private async tryWebSquareSetValue(objectId: string, text: string): Promise<boolean> {
    const isWS = await this.detectWebSquare();
    if (!isWS) return false;

    try {
      const result = await this.transport.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function(text) {
          var el = this;
          var id = el.id;
          var parentId = el.parentElement ? el.parentElement.id : '';

          // Try finding WebSquare component by element id, then parent id
          var comp = null;
          try { comp = WebSquare.util.getComponentById(id); } catch(e) {}
          if (!comp || typeof comp.setValue !== 'function') {
            comp = null;
            try { comp = WebSquare.util.getComponentById(parentId); } catch(e) {}
          }
          if (!comp || typeof comp.setValue !== 'function') return false;

          comp.setValue(text);
          return true;
        }`,
        arguments: [{ value: text }],
        returnByValue: true,
      }) as Record<string, unknown>;
      const r = result.result as Record<string, unknown>;
      return r?.value === true;
    } catch {
      return false;
    }
  }

  async goto(url: string, waitStrategy?: 'load' | 'networkIdle'): Promise<GotoResult> {
    this.resetFrameworkCache();
    return this.page.navigate(url, waitStrategy);
  }

  async click(selector: string): Promise<void> {
    // 1. Get root document node
    const docResult = await this.transport.send('DOM.getDocument', {
      depth: 0,
    }) as Record<string, unknown>;
    const root = docResult.root as Record<string, unknown>;
    const rootNodeId = root.nodeId as number;

    // 2. Find element by selector
    const queryResult = await this.transport.send('DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    }) as Record<string, unknown>;

    const nodeId = queryResult.nodeId as number;
    if (!nodeId) {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    // 3. Get box model for coordinates, with fallback for zero-size elements
    try {
      const boxResult = await this.transport.send('DOM.getBoxModel', {
        nodeId,
      }) as Record<string, unknown>;

      const model = boxResult.model as Record<string, unknown>;
      const content = model.content as number[];

      // 4. Calculate center from quad [x1,y1,x2,y2,x3,y3,x4,y4]
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;

      // Check for zero-size element
      if (x === 0 && y === 0) {
        throw new Error('zero-size element');
      }

      // 5. Dispatch mouse events
      await this._dispatchClick(x, y);
    } catch {
      // Fallback: use JS click for zero-size or hidden elements
      const describeResult = await this.transport.send('DOM.describeNode', {
        nodeId,
      }) as Record<string, unknown>;
      const node = describeResult.node as Record<string, unknown>;
      const backendNodeId = node.backendNodeId as number;
      const resolveResult = await this.transport.send('DOM.resolveNode', {
        backendNodeId,
      }) as Record<string, unknown>;
      const remoteObject = resolveResult.object as Record<string, unknown>;
      const objectId = remoteObject.objectId as string;
      await this.transport.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.scrollIntoView(); this.click(); }`,
        returnByValue: true,
      });
    }
    await this.page.waitForStable();
  }

  async clickByBackendNodeId(backendNodeId: number): Promise<void> {
    try {
      // 1. Get nodeId from backendNodeId
      const describeResult = await this.transport.send('DOM.describeNode', {
        backendNodeId,
      }) as Record<string, unknown>;
      const node = describeResult.node as Record<string, unknown>;
      const nodeId = node.nodeId as number;

      // 2. Get box model
      const boxResult = await this.transport.send('DOM.getBoxModel', {
        backendNodeId,
        nodeId,
      }) as Record<string, unknown>;

      const model = boxResult.model as Record<string, unknown>;
      const content = model.content as number[];

      // 3. Calculate center
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;

      // 4. Dispatch mouse events
      await this._dispatchClick(x, y);
    } catch {
      // Fallback: resolve node via CDP and call .click() on the RemoteObject
      const resolveResult = await this.transport.send('DOM.resolveNode', {
        backendNodeId,
      }) as Record<string, unknown>;
      const remoteObject = resolveResult.object as Record<string, unknown>;
      const objectId = remoteObject.objectId as string;
      await this.transport.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { this.scrollIntoView(); this.click(); }`,
        returnByValue: true,
      });
    }
    await this.page.waitForStable();
  }

  private async _dispatchClick(x: number, y: number): Promise<void> {
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  /**
   * Resolve a CSS selector to a backendNodeId via CDP.
   * Works with any framework — addresses elements directly by selector.
   */
  private async resolveSelector(selector: string): Promise<number> {
    const docResult = await this.transport.send('DOM.getDocument', {
      depth: 0,
    }) as Record<string, unknown>;
    const root = docResult.root as Record<string, unknown>;
    const rootNodeId = root.nodeId as number;

    const queryResult = await this.transport.send('DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    }) as Record<string, unknown>;

    const nodeId = queryResult.nodeId as number;
    if (!nodeId) {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    const describeResult = await this.transport.send('DOM.describeNode', {
      nodeId,
    }) as Record<string, unknown>;
    const node = describeResult.node as Record<string, unknown>;
    return node.backendNodeId as number;
  }

  /**
   * Fill an element by CSS selector using human-like character-by-character typing.
   * Bypasses agentId — works with WebSquare, custom widgets, etc.
   * Uses DOM.focus + Input.insertText for maximum compatibility.
   */
  async fillBySelector(selector: string, text: string): Promise<void> {
    const backendNodeId = await this.resolveSelector(selector);

    // 1. Resolve to RemoteObject
    const resolveResult = await this.transport.send('DOM.resolveNode', {
      backendNodeId,
    }) as Record<string, unknown>;
    const remoteObject = resolveResult.object as Record<string, unknown>;
    const objectId = remoteObject.objectId as string;

    // 2. Try WebSquare setValue first (handles internal state model)
    const wsHandled = await this.tryWebSquareSetValue(objectId, text);
    if (wsHandled) return;

    // 3. Clear existing value via JS
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.scrollIntoView({ block: 'center' });
        if ('value' in this) this.value = '';
      }`,
      returnByValue: true,
    });

    // 4. Focus using CDP DOM.focus (browser-level, survives framework event handling)
    await this.transport.send('DOM.focus', {
      backendNodeId,
    });

    // 5. Click to activate (some frameworks need this)
    try {
      const boxResult = await this.transport.send('DOM.getBoxModel', {
        backendNodeId,
      }) as Record<string, unknown>;
      const model = boxResult.model as Record<string, unknown>;
      const content = model.content as number[];
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;
      await this._dispatchClick(x, y);
    } catch {
      // fallback: just use focus
    }

    // 6. Type character by character using Input.insertText (IME-compatible)
    for (const char of text) {
      await this.transport.send('Input.insertText', {
        text: char,
      });

      const delay = 50 + Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 7. Dispatch input/change events for framework reactivity
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      returnByValue: true,
    });
  }

  /**
   * Click an element by CSS selector with robust fallback.
   * Bypasses agentId — works with WebSquare, custom widgets, etc.
   */
  async clickBySelector(selector: string): Promise<void> {
    const backendNodeId = await this.resolveSelector(selector);
    await this.clickByBackendNodeId(backendNodeId);
  }

  /**
   * Focus an element by CSS selector.
   * Uses CDP DOM.focus for reliable browser-level focusing.
   * Useful before type() to direct keyboard input to a specific element.
   */
  async focusBySelector(selector: string): Promise<void> {
    const backendNodeId = await this.resolveSelector(selector);

    // Scroll into view first
    const resolveResult = await this.transport.send('DOM.resolveNode', {
      backendNodeId,
    }) as Record<string, unknown>;
    const remoteObject = resolveResult.object as Record<string, unknown>;
    const objectId = remoteObject.objectId as string;
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() { this.scrollIntoView({ block: 'center' }); }`,
      returnByValue: true,
    });

    // Use CDP DOM.focus for reliable browser-level focus
    await this.transport.send('DOM.focus', {
      backendNodeId,
    });
  }

  /**
   * Type text character-by-character into the currently focused element via CDP.
   * No element targeting — works with whatever has focus.
   * Framework-agnostic: WebSquare, React, Angular, vanilla — all receive real keyboard events.
   *
   * Uses Input.insertText for reliable text insertion (handles Korean IME, Unicode, etc.)
   * combined with Input.dispatchKeyEvent for proper event triggering.
   */
  async type(text: string): Promise<void> {
    for (const char of text) {
      // Use insertText for reliable character insertion (IME-compatible)
      await this.transport.send('Input.insertText', {
        text: char,
      });

      // Human-like delay: 30–100ms
      const delay = 30 + Math.floor(Math.random() * 70);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Press a key or key combination (e.g., "Enter", "ctrl+a", "shift+tab", "ctrl+shift+k").
   * Modifier keys: ctrl, shift, alt, meta (cmd on Mac).
   * Sends keyDown + keyUp via CDP Input.dispatchKeyEvent with modifier bitmask.
   */
  async pressKey(key: string): Promise<void> {
    const keyMap: Record<string, { key: string; code: string; text?: string }> = {
      'enter':     { key: 'Enter', code: 'Enter', text: '\r' },
      'tab':       { key: 'Tab', code: 'Tab' },
      'backspace': { key: 'Backspace', code: 'Backspace' },
      'delete':    { key: 'Delete', code: 'Delete' },
      'escape':    { key: 'Escape', code: 'Escape' },
      'arrowup':   { key: 'ArrowUp', code: 'ArrowUp' },
      'arrowdown': { key: 'ArrowDown', code: 'ArrowDown' },
      'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft' },
      'arrowright':{ key: 'ArrowRight', code: 'ArrowRight' },
      'home':      { key: 'Home', code: 'Home' },
      'end':       { key: 'End', code: 'End' },
      'pageup':    { key: 'PageUp', code: 'PageUp' },
      'pagedown':  { key: 'PageDown', code: 'PageDown' },
      'space':     { key: ' ', code: 'Space', text: ' ' },
    };

    // Parse modifier combo: "ctrl+shift+a" → modifiers + key
    const parts = key.toLowerCase().split('+');
    let modifiers = 0;
    const modifierMap: Record<string, number> = {
      'alt': 1, 'ctrl': 2, 'control': 2, 'meta': 4, 'cmd': 4, 'command': 4, 'shift': 8,
    };

    const modifierKeys: string[] = [];
    let mainKey = '';
    for (const part of parts) {
      if (modifierMap[part] !== undefined) {
        modifiers |= modifierMap[part];
        modifierKeys.push(part);
      } else {
        mainKey = part;
      }
    }

    // If no main key was found (e.g., just "ctrl"), treat the last modifier as the key
    if (!mainKey && modifierKeys.length > 0) {
      mainKey = modifierKeys.pop()!;
      modifiers = 0;
      for (const mk of modifierKeys) {
        modifiers |= modifierMap[mk];
      }
    }

    // Look up in keyMap first, then treat as single character
    const info = keyMap[mainKey];
    let keyName: string;
    let code: string;
    let text: string | undefined;

    if (info) {
      keyName = info.key;
      code = info.code;
      text = info.text;
    } else if (mainKey.length === 1) {
      // Single character key (a-z, 0-9, etc.)
      keyName = modifiers & 8 ? mainKey.toUpperCase() : mainKey; // Shift → uppercase
      code = `Key${mainKey.toUpperCase()}`;
      text = modifiers ? undefined : mainKey; // Don't send text for combo keys
    } else {
      throw new Error(`Unknown key: ${key}. Supported: ${Object.keys(keyMap).join(', ')}, or single characters with modifiers (ctrl+a, shift+tab)`);
    }

    const eventBase: Record<string, unknown> = {
      key: keyName,
      code,
      modifiers,
    };
    if (text) eventBase.text = text;

    await this.transport.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      ...eventBase,
    });
    await this.transport.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyName,
      code,
      modifiers,
    });
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.transport.send('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});

          // Try WebSquare setValue first
          if (typeof window.WebSquare !== 'undefined' && WebSquare.util && typeof WebSquare.util.getComponentById === 'function') {
            var comp = null;
            try { comp = WebSquare.util.getComponentById(el.id); } catch(e) {}
            if (!comp || typeof comp.setValue !== 'function') {
              try { comp = WebSquare.util.getComponentById(el.parentElement.id); } catch(e) {}
            }
            if (comp && typeof comp.setValue === 'function') {
              comp.setValue(${JSON.stringify(text)});
              return;
            }
          }

          // Fallback: DOM-based fill
          el.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(el, ${JSON.stringify(text)});
          } else {
            el.value = ${JSON.stringify(text)};
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `,
      returnByValue: true,
    });
  }

  async fillByBackendNodeId(backendNodeId: number, text: string): Promise<void> {
    // 1. Resolve node to get RemoteObject
    const resolveResult = await this.transport.send('DOM.resolveNode', {
      backendNodeId,
    }) as Record<string, unknown>;

    const remoteObject = resolveResult.object as Record<string, unknown>;
    const objectId = remoteObject.objectId as string;

    // 2. Try WebSquare setValue first (handles internal state model)
    const wsHandled = await this.tryWebSquareSetValue(objectId, text);
    if (wsHandled) return;

    // 3. Scroll into view and focus the element
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() { this.scrollIntoView({ block: 'center' }); this.focus(); }`,
      returnByValue: true,
    });

    // 4. Clear existing value and type using native setter for React compatibility
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `
        function(value) {
          // Use native setter to bypass React's synthetic event system
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(this, value);
          } else {
            this.value = value;
          }
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }
      `,
      arguments: [{ value: text }],
      returnByValue: true,
    });
  }

  /**
   * Human-like typing: focus the element, clear it, then type character by character
   * with random delays between keystrokes (50–150ms).
   */
  async fillHumanByBackendNodeId(backendNodeId: number, text: string): Promise<void> {
    // 1. Resolve node to get RemoteObject
    const resolveResult = await this.transport.send('DOM.resolveNode', {
      backendNodeId,
    }) as Record<string, unknown>;

    const remoteObject = resolveResult.object as Record<string, unknown>;
    const objectId = remoteObject.objectId as string;

    // 2. Try WebSquare setValue first (handles internal state model)
    const wsHandled = await this.tryWebSquareSetValue(objectId, text);
    if (wsHandled) return;

    // 3. Focus the element
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() { this.focus(); this.value = ''; }`,
      returnByValue: true,
    });

    // 4. Click the element to ensure it's active
    try {
      const boxResult = await this.transport.send('DOM.getBoxModel', {
        backendNodeId,
      }) as Record<string, unknown>;
      const model = boxResult.model as Record<string, unknown>;
      const content = model.content as number[];
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;
      await this._dispatchClick(x, y);
    } catch {
      // fallback: just focus
    }

    // 5. Type character by character with random delays
    // Uses Input.insertText for reliable text insertion (handles Korean IME, Unicode, etc.)
    for (const char of text) {
      await this.transport.send('Input.insertText', {
        text: char,
      });

      // Random delay: 50–150ms
      const delay = 50 + Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 6. Dispatch input and change events
    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      returnByValue: true,
    });
  }

  /**
   * Select an option from a <select> element by its visible text or value.
   * Dispatches proper change events.
   */
  async selectByBackendNodeId(backendNodeId: number, optionValue: string): Promise<void> {
    const resolveResult = await this.transport.send('DOM.resolveNode', {
      backendNodeId,
    }) as Record<string, unknown>;

    const remoteObject = resolveResult.object as Record<string, unknown>;
    const objectId = remoteObject.objectId as string;

    await this.transport.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `
        function(targetValue) {
          // Try matching by value first, then by text content
          let found = false;
          for (const opt of this.options) {
            if (opt.value === targetValue || opt.textContent.trim() === targetValue) {
              this.value = opt.value;
              found = true;
              break;
            }
          }
          if (!found) throw new Error('Option not found: ' + targetValue);
          this.dispatchEvent(new Event('change', { bubbles: true }));
          this.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `,
      arguments: [{ value: optionValue }],
      returnByValue: true,
    });
  }

  /**
   * Navigate back in browser history.
   */
  async goBack(): Promise<void> {
    const historyResult = await this.transport.send('Page.getNavigationHistory') as Record<string, unknown>;
    const currentIndex = historyResult.currentIndex as number;
    const entries = historyResult.entries as Array<Record<string, unknown>>;
    if (currentIndex > 0) {
      const entryId = entries[currentIndex - 1].id as number;
      await this.transport.send('Page.navigateToHistoryEntry', { entryId });
      await this.page.waitForStable();
    }
    this.resetFrameworkCache();
  }

  /**
   * Navigate forward in browser history.
   */
  async goForward(): Promise<void> {
    const historyResult = await this.transport.send('Page.getNavigationHistory') as Record<string, unknown>;
    const currentIndex = historyResult.currentIndex as number;
    const entries = historyResult.entries as Array<Record<string, unknown>>;
    if (currentIndex < entries.length - 1) {
      const entryId = entries[currentIndex + 1].id as number;
      await this.transport.send('Page.navigateToHistoryEntry', { entryId });
      await this.page.waitForStable();
    }
    this.resetFrameworkCache();
  }

  /**
   * Hover over an element by backendNodeId.
   * Dispatches a mouseMoved event at the element's center.
   */
  async hoverByBackendNodeId(backendNodeId: number): Promise<void> {
    try {
      const boxResult = await this.transport.send('DOM.getBoxModel', {
        backendNodeId,
      }) as Record<string, unknown>;
      const model = boxResult.model as Record<string, unknown>;
      const content = model.content as number[];
      const x = (content[0] + content[2] + content[4] + content[6]) / 4;
      const y = (content[1] + content[3] + content[5] + content[7]) / 4;
      await this.transport.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
      });
    } catch {
      // Fallback: scroll into view and dispatch mouseover event via JS
      const resolveResult = await this.transport.send('DOM.resolveNode', {
        backendNodeId,
      }) as Record<string, unknown>;
      const remoteObject = resolveResult.object as Record<string, unknown>;
      const objectId = remoteObject.objectId as string;
      await this.transport.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          this.scrollIntoView({ block: 'center' });
          this.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          this.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        }`,
        returnByValue: true,
      });
    }
  }

  /**
   * Scroll the page by a given amount in pixels.
   * Uses Input.dispatchMouseEvent with type 'mouseWheel'.
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', pixels: number = 300): Promise<void> {
    let deltaX = 0;
    let deltaY = 0;
    switch (direction) {
      case 'up':    deltaY = -pixels; break;
      case 'down':  deltaY = pixels; break;
      case 'left':  deltaX = -pixels; break;
      case 'right': deltaX = pixels; break;
    }
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 400,
      y: 300,
      deltaX,
      deltaY,
    });
    // Brief pause for scroll to settle
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  /**
   * Wait for a CSS selector to appear in the DOM.
   * Polls every 200ms until found or timeout.
   */
  async waitForSelector(selector: string, timeout: number = 5000): Promise<boolean> {
    const interval = 200;
    const maxAttempts = Math.ceil(timeout / interval);
    for (let i = 0; i < maxAttempts; i++) {
      const result = await this.transport.send('Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      }) as Record<string, unknown>;
      const r = result.result as Record<string, unknown>;
      if (r?.value === true) return true;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return false;
  }

  async runJs(script: string): Promise<unknown> {
    const result = await this.transport.send('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
    }) as Record<string, unknown>;

    if (result.exceptionDetails) {
      const details = result.exceptionDetails as Record<string, unknown>;
      const exceptionText = details.text as string | undefined;
      throw new Error(`JavaScript error: ${exceptionText ?? 'Unknown error'}`);
    }

    const r = result.result as Record<string, unknown> | undefined;
    return r?.value;
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.transport.send('Page.captureScreenshot', {
      format: 'png',
    }) as Record<string, unknown>;

    const data = result.data as string;
    return Buffer.from(data, 'base64');
  }

  async setupDownloads(downloadPath: string): Promise<void> {
    await this.transport.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true,
    });
  }

  async download(url: string, downloadPath: string, timeout: number = 60000): Promise<DownloadResult> {
    await this.setupDownloads(downloadPath);

    return new Promise<DownloadResult>((resolve, reject) => {
      let downloadGuid: string | null = null;
      let filename = '';
      let timeoutTimer: ReturnType<typeof setTimeout>;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        this.transport.off('Browser.downloadWillBegin', onBegin);
        this.transport.off('Browser.downloadProgress', onProgress);
      };

      const onBegin = (params: any) => {
        downloadGuid = params.guid;
        filename = params.suggestedFilename || 'download';
      };

      const onProgress = (params: any) => {
        if (params.guid !== downloadGuid) return;
        if (params.state === 'completed') {
          cleanup();
          const filePath = join(downloadPath, filename);
          resolve({
            success: true,
            filePath,
            filename,
            size: params.receivedBytes || 0,
          });
        } else if (params.state === 'canceled') {
          cleanup();
          reject(new Error('Download was canceled'));
        }
      };

      this.transport.on('Browser.downloadWillBegin', onBegin);
      this.transport.on('Browser.downloadProgress', onProgress);

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`Download timed out after ${timeout}ms`));
      }, timeout);

      // Navigate to the download URL to trigger the download
      this.transport.send('Page.navigate', { url }).catch(err => {
        cleanup();
        reject(err);
      });
    });
  }

  async downloadByClick(backendNodeId: number, downloadPath: string, timeout: number = 60000): Promise<DownloadResult> {
    await this.setupDownloads(downloadPath);

    return new Promise<DownloadResult>((resolve, reject) => {
      let downloadGuid: string | null = null;
      let filename = '';
      let timeoutTimer: ReturnType<typeof setTimeout>;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        this.transport.off('Browser.downloadWillBegin', onBegin);
        this.transport.off('Browser.downloadProgress', onProgress);
      };

      const onBegin = (params: any) => {
        downloadGuid = params.guid;
        filename = params.suggestedFilename || 'download';
      };

      const onProgress = (params: any) => {
        if (params.guid !== downloadGuid) return;
        if (params.state === 'completed') {
          cleanup();
          resolve({
            success: true,
            filePath: join(downloadPath, filename),
            filename,
            size: params.receivedBytes || 0,
          });
        } else if (params.state === 'canceled') {
          cleanup();
          reject(new Error('Download was canceled'));
        }
      };

      this.transport.on('Browser.downloadWillBegin', onBegin);
      this.transport.on('Browser.downloadProgress', onProgress);

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`Download timed out after ${timeout}ms`));
      }, timeout);

      // Click the element to trigger download
      this.clickByBackendNodeId(backendNodeId).catch(err => {
        cleanup();
        reject(err);
      });
    });
  }
}
