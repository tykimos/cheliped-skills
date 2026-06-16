import type { CDPTransport } from '../cdp/transport.js';
import type { SemanticElement } from '../types/internal-dom.types.js';

/** Frame information returned by listFrames. */
export interface FrameDetail {
  frameId: string;
  url: string;
  name: string;
  index: number;
  /** Whether an isolated world context is currently active for this frame. */
  contextReady: boolean;
}

/** Minimal shape from Page.getFrameTree */
interface FrameTreeInfo {
  frame: { id: string; url: string; name?: string; securityOrigin?: string };
  childFrames?: FrameTreeInfo[];
}

/**
 * Manages iframe discovery, context creation, and in-frame interactions.
 *
 * Key insight: CDP's DOM commands (DOM.resolveNode, DOM.focus) don't work across
 * frame boundaries for elements without a real backendNodeId. Instead, we:
 *   1. Create an isolated world in the target frame (Page.createIsolatedWorld)
 *   2. Use Runtime.evaluate with that contextId to query/interact via JS
 *   3. For clicks: get element bounds inside iframe + iframe position on main page,
 *      then dispatch Input.dispatchMouseEvent at the computed absolute coordinates.
 *      This produces real browser mouse events that pass CAPTCHA bot detection.
 */
export class FrameManager {
  /** frameId -> executionContextId */
  private contextCache = new Map<string, number>();
  /** Ordered list of child frames from last discovery */
  private frameList: FrameDetail[] = [];

  constructor(private transport: CDPTransport) {}

  /** Discover all child frames on the current page, including those inside shadow DOM. */
  async listFrames(): Promise<FrameDetail[]> {
    const result = (await this.transport.send('Page.getFrameTree', {})) as {
      frameTree: FrameTreeInfo;
    };

    const frames: FrameDetail[] = [];
    this.collectFrames(result.frameTree, frames);

    // Also discover iframes hidden inside shadow DOM via JS
    // Page.getFrameTree may miss dynamically injected iframes in shadow roots
    try {
      const jsResult = await this.transport.send('Runtime.evaluate', {
        expression: `(function() {
          var found = [];
          function scanShadow(root) {
            var all = root.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
              if (all[i].shadowRoot) {
                var iframes = all[i].shadowRoot.querySelectorAll('iframe');
                for (var j = 0; j < iframes.length; j++) {
                  found.push({ src: iframes[j].src || '', name: iframes[j].name || '', id: iframes[j].id || '' });
                }
                scanShadow(all[i].shadowRoot);
              }
            }
          }
          scanShadow(document);
          return found;
        })()`,
        returnByValue: true,
      }) as { result?: { value?: Array<{ src: string; name: string; id: string }> } };

      const shadowIframes = jsResult.result?.value ?? [];
      for (const si of shadowIframes) {
        // Check if already in frame list by URL match
        const alreadyListed = frames.some(
          f => f.url === si.src || (si.src && f.url.includes(si.src)) || (si.src && si.src.includes(f.url))
        );
        if (!alreadyListed && si.src) {
          frames.push({
            frameId: `shadow-iframe-${frames.length}`,
            url: si.src,
            name: si.name || si.id || '',
            index: frames.length,
            contextReady: false,
          });
        }
      }
    } catch {
      // Best-effort: shadow DOM scan failure doesn't block normal frame listing
    }

    this.frameList = frames;
    return frames;
  }

  /** Resolve a frame target to a frameId. Accepts index (number) or URL substring. */
  async resolveFrame(target: string | number): Promise<string> {
    if (this.frameList.length === 0) {
      await this.listFrames();
    }

    if (typeof target === 'number' || /^\d+$/.test(String(target))) {
      const idx = typeof target === 'number' ? target : parseInt(target, 10);
      const frame = this.frameList[idx];
      if (!frame) {
        throw new Error(
          `Frame index ${idx} out of range (${this.frameList.length} frames). ` +
          `Use list-frames to see available frames.`
        );
      }
      return frame.frameId;
    }

    // Match by URL substring or name
    const needle = String(target).toLowerCase();
    const match = this.frameList.find(
      f => f.url.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle)
    );
    if (!match) {
      throw new Error(
        `No frame matching "${target}". Available: ${this.frameList.map(f => f.url).join(', ')}`
      );
    }
    return match.frameId;
  }

  /** Get or create an isolated world execution context for a frame. */
  async getContext(frameId: string): Promise<number> {
    const cached = this.contextCache.get(frameId);
    if (cached !== undefined) {
      // Verify context is still valid
      try {
        await this.transport.send('Runtime.evaluate', {
          expression: '1',
          contextId: cached,
          returnByValue: true,
        });
        return cached;
      } catch {
        this.contextCache.delete(frameId);
      }
    }

    const worldResult = (await this.transport.send('Page.createIsolatedWorld', {
      frameId,
      grantUniversalAccess: true,
    })) as { executionContextId: number };

    this.contextCache.set(frameId, worldResult.executionContextId);
    return worldResult.executionContextId;
  }

  /** Run JavaScript inside an iframe. */
  async evaluateInFrame(frameId: string, expression: string): Promise<unknown> {
    const contextId = await this.getContext(frameId);
    const result = (await this.transport.send('Runtime.evaluate', {
      expression,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };

    if (result.exceptionDetails) {
      throw new Error(`JS error in frame: ${result.exceptionDetails.text ?? 'Unknown'}`);
    }
    return result.result?.value;
  }

  /**
   * Observe interactive elements inside an iframe.
   * Returns semantic elements with text, type, attributes — similar to main observe().
   */
  async observeFrame(frameId: string): Promise<{
    url: string;
    elements: Array<{
      index: number;
      tag: string;
      type?: string;
      text: string;
      placeholder?: string;
      selector: string;
      attributes: Record<string, string>;
    }>;
  }> {
    const result = await this.evaluateInFrame(frameId, `(function() {
      const SELECTORS = 'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="checkbox"], label, h1, h2, h3, h4, h5, h6, p, li, img, [tabindex]';
      const els = Array.from(document.querySelectorAll(SELECTORS));
      const visible = els.filter(function(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden';
      });
      return {
        url: window.location.href,
        elements: visible.map(function(el, i) {
          // Build a unique CSS selector for this element
          var sel = '';
          if (el.id) {
            sel = '#' + CSS.escape(el.id);
          } else if (el.name) {
            sel = el.tagName.toLowerCase() + '[name=' + JSON.stringify(el.name) + ']';
          } else if (el.className && typeof el.className === 'string' && el.className.trim()) {
            var cls = el.className.trim().split(/\\s+/).slice(0, 2).map(function(c) { return '.' + CSS.escape(c); }).join('');
            sel = el.tagName.toLowerCase() + cls;
          } else {
            sel = el.tagName.toLowerCase();
            // Add nth-of-type for disambiguation
            var siblings = el.parentElement ? Array.from(el.parentElement.querySelectorAll(':scope > ' + el.tagName.toLowerCase())) : [];
            if (siblings.length > 1) {
              var idx = siblings.indexOf(el) + 1;
              sel += ':nth-of-type(' + idx + ')';
            }
          }
          var attrs = {};
          for (var a of el.attributes) { attrs[a.name] = a.value; }
          return {
            index: i,
            tag: el.tagName.toLowerCase(),
            type: el.type || undefined,
            text: (el.textContent || '').trim().slice(0, 200),
            placeholder: el.placeholder || undefined,
            selector: sel,
            attributes: attrs,
          };
        })
      };
    })()`);

    return result as any;
  }

  /**
   * Click an element inside an iframe using absolute coordinate dispatch.
   *
   * Strategy:
   * 1. Find the iframe element's bounding rect on the main page
   * 2. Find the target element's bounding rect inside the iframe
   * 3. Compute absolute coordinates = iframe offset + element center
   * 4. Dispatch real mouse events via Input.dispatchMouseEvent
   */
  async clickInFrame(frameId: string, selector: string): Promise<void> {
    // Step 1: Find iframe element position on the main page
    const iframeRect = await this.getIframeRect(frameId);

    // Step 2: Get target element's bounding rect inside the iframe
    const elementRect = await this.evaluateInFrame(frameId, `(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found in iframe: ${selector}');
      el.scrollIntoView({ block: 'center', inline: 'center' });
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);

    const elRect = elementRect as { x: number; y: number; width: number; height: number };

    // Step 3: Compute absolute coordinates
    const absX = iframeRect.x + elRect.x + elRect.width / 2;
    const absY = iframeRect.y + elRect.y + elRect.height / 2;

    // Step 4: Dispatch real mouse events (mouseMoved → mousePressed → mouseReleased)
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: absX,
      y: absY,
    });
    await new Promise(r => setTimeout(r, 50 + Math.floor(Math.random() * 80)));

    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: absX,
      y: absY,
      button: 'left',
      clickCount: 1,
    });
    await this.transport.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: absX,
      y: absY,
      button: 'left',
      clickCount: 1,
    });

    // Brief pause for event propagation
    await new Promise(r => setTimeout(r, 200));
  }

  /**
   * Fill an input element inside an iframe.
   *
   * Strategy: focus via coordinate click, then use Input.insertText for each character.
   * This produces real keyboard events that pass bot detection.
   */
  async fillInFrame(frameId: string, selector: string, text: string): Promise<void> {
    // Clear existing value via JS
    await this.evaluateInFrame(frameId, `(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found in iframe: ${selector}');
      if ('value' in el) el.value = '';
    })()`);

    // Click to focus
    await this.clickInFrame(frameId, selector);
    await new Promise(r => setTimeout(r, 100));

    // Type character by character
    for (const char of text) {
      await this.transport.send('Input.insertText', { text: char });
      const delay = 50 + Math.floor(Math.random() * 100);
      await new Promise(r => setTimeout(r, delay));
    }

    // Dispatch input/change events
    await this.evaluateInFrame(frameId, `(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
  }

  /** Invalidate cached contexts (call after navigation). */
  clearCache(): void {
    this.contextCache.clear();
    this.frameList = [];
  }

  // ── Private helpers ──

  /** Get the bounding rect of an iframe element on the main page, given its frameId. */
  private async getIframeRect(frameId: string): Promise<{ x: number; y: number; width: number; height: number }> {
    // Strategy: find which iframe element hosts this frameId by checking all iframes
    // on the main page and matching their contentWindow.
    // Since we can't directly access contentWindow frameId from JS, we use
    // Page.getFrameTree to get the frame's URL, then match by src attribute.

    // Get the frame's URL from the frame tree
    const frameTree = (await this.transport.send('Page.getFrameTree', {})) as {
      frameTree: FrameTreeInfo;
    };
    const frameInfo = this.findFrameById(frameTree.frameTree, frameId);
    if (!frameInfo) {
      throw new Error(`Frame ${frameId} not found in frame tree`);
    }

    // Try to find iframe by matching frameId through CDP DOM
    // First try: use DOM to find all iframe/frame elements and match via frame owner
    try {
      const docResult = await this.transport.send('DOM.getDocument', { depth: 0 }) as Record<string, unknown>;
      const root = docResult.root as Record<string, unknown>;
      const rootNodeId = root.nodeId as number;

      // Query all iframe elements
      const iframeNodes = await this.transport.send('DOM.querySelectorAll', {
        nodeId: rootNodeId,
        selector: 'iframe, frame',
      }) as { nodeIds: number[] };

      for (const nodeId of iframeNodes.nodeIds) {
        // Get frame owner info
        try {
          const descResult = await this.transport.send('DOM.describeNode', {
            nodeId,
            pierce: true,
          }) as { node: { frameId?: string; contentDocument?: { frameId?: string } } };

          const nodeFrameId = descResult.node.contentDocument?.frameId ?? descResult.node.frameId;
          if (nodeFrameId === frameId) {
            // Found the iframe! Get its box model
            const boxResult = await this.transport.send('DOM.getBoxModel', {
              nodeId,
            }) as { model: { content: number[] } };

            const content = boxResult.model.content;
            const x = Math.min(content[0], content[2], content[4], content[6]);
            const y = Math.min(content[1], content[3], content[5], content[7]);
            const maxX = Math.max(content[0], content[2], content[4], content[6]);
            const maxY = Math.max(content[1], content[3], content[5], content[7]);
            return { x, y, width: maxX - x, height: maxY - y };
          }
        } catch {
          continue;
        }
      }
    } catch {
      // DOM approach failed, fall back to JS
    }

    // Fallback: match iframe by src attribute (less reliable for dynamic iframes)
    const frameUrl = frameInfo.frame.url;
    const result = await this.transport.send('Runtime.evaluate', {
      expression: `(function() {
        var iframes = document.querySelectorAll('iframe, frame');
        for (var i = 0; i < iframes.length; i++) {
          var iframe = iframes[i];
          var src = iframe.src || '';
          var matchUrl = ${JSON.stringify(frameUrl)};
          // Match by exact src, or by origin+path for cross-origin
          if (src === matchUrl || src.indexOf(matchUrl) !== -1 || matchUrl.indexOf(src) !== -1) {
            var r = iframe.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }
        }
        // Last resort: if only one iframe, use it
        if (iframes.length === 1) {
          var r = iframes[0].getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        // If multiple, try matching by index from frame tree
        var idx = ${JSON.stringify(this.frameList.findIndex(f => f.frameId === frameId))};
        if (idx >= 0 && idx < iframes.length) {
          var r = iframes[idx].getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return null;
      })()`,
      returnByValue: true,
    }) as { result?: { value?: unknown } };

    const rect = result?.result?.value as { x: number; y: number; width: number; height: number } | null;
    if (!rect) {
      throw new Error(`Could not locate iframe element for frame ${frameId} on the page.`);
    }
    return rect;
  }

  private collectFrames(tree: FrameTreeInfo, out: FrameDetail[]): void {
    if (tree.childFrames) {
      for (const child of tree.childFrames) {
        out.push({
          frameId: child.frame.id,
          url: child.frame.url,
          name: child.frame.name ?? '',
          index: out.length,
          contextReady: this.contextCache.has(child.frame.id),
        });
        // Recurse for nested iframes
        this.collectFrames(child, out);
      }
    }
  }

  private findFrameById(tree: FrameTreeInfo, targetId: string): FrameTreeInfo | null {
    if (tree.frame.id === targetId) return tree;
    if (tree.childFrames) {
      for (const child of tree.childFrames) {
        const found = this.findFrameById(child, targetId);
        if (found) return found;
      }
    }
    return null;
  }
}
