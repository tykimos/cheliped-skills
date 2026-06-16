import { tmpdir } from 'os';
import { join } from 'path';
import { CDPConnection } from '../cdp/connection.js';
import { BrowserController } from '../browser/controller.js';
import { AgentDomBuilder } from '../dom/agent-dom.js';
import { DomExtractor } from '../dom/extractor.js';
import { DomFilter } from '../dom/filter.js';
import { SemanticExtractor } from '../dom/semantic.js';
import { TokenCompressor } from '../dom/compressor.js';
import { UIGraphBuilder } from '../graph/ui-graph.js';
import { ActionGenerator } from '../graph/action-generator.js';
import { SessionManager } from '../session/session-manager.js';
import { SecurityLayer } from '../security/security-layer.js';
import { PromptGuard } from '../security/prompt-guard.js';
import type { ChelipedOptions, LaunchResult } from '../types/options.types.js';
import type { AgentDom } from '../types/agent-dom.types.js';
import type { GotoResult, ActResult, ExtractResult, ScreenshotResult, DownloadResult, ActSemanticResult, SearchResult, SearchEngine, SearchResultItem } from '../types/api.types.js';
import type { UIGraph } from '../graph/ui-graph.types.js';
import type { SemanticAction } from '../graph/action.types.js';

export class Cheliped {
  private options: ChelipedOptions;
  private connection: CDPConnection | null = null;
  private controller: BrowserController | null = null;
  private agentDomBuilder: AgentDomBuilder = new AgentDomBuilder();
  private _extractor = new DomExtractor();
  private _domFilter = new DomFilter();
  private _semanticExtractor = new SemanticExtractor();
  private graphBuilder = new UIGraphBuilder();
  private actionGenerator = new ActionGenerator();
  private sessionManager: SessionManager | null = null;
  private securityLayer: SecurityLayer | null = null;
  private promptGuard: PromptGuard | null = null;

  constructor(options?: ChelipedOptions) {
    this.options = { headless: true, ...options };
  }

  async launch(): Promise<void> {
    let userDataDir: string | undefined;

    // Set up session manager if session options provided
    if (this.options.session) {
      this.sessionManager = new SessionManager(this.options.session);
      const profile = await this.sessionManager.initialize();
      userDataDir = profile.userDataDir;
    }

    this.connection = new CDPConnection();
    await this.connection.connect(this.options, userDataDir);
    this.controller = new BrowserController(this.connection.getTransport());

    // Restore cookies if session has persistCookies
    if (this.sessionManager && this.options.session?.persistCookies) {
      await this.sessionManager.restoreCookies(this.connection.getTransport());
    }

    // Set up security layer if security options provided
    if (this.options.security) {
      this.securityLayer = new SecurityLayer(this.options.security);
      await this.securityLayer.attachToTransport(this.connection.getTransport());

      if (this.options.security.enablePromptGuard) {
        this.promptGuard = new PromptGuard();
      }
    }
  }

  async goto(url: string): Promise<GotoResult> {
    this.ensureLaunched();
    if (this.securityLayer) {
      const validation = this.securityLayer.validateNavigation(url);
      if (!validation.allowed) {
        throw new Error(`Navigation blocked: ${validation.reason}`);
      }
      this.securityLayer.setInitialDomain(url);
    }
    return this.controller!.goto(url, this.options.waitStrategy);
  }

  async observe(): Promise<AgentDom> {
    this.ensureLaunched();
    return this.agentDomBuilder.extractAgentDom(
      this.connection!.getTransport(),
      this.options.compression,
    );
  }

  async observeGraph(): Promise<UIGraph> {
    this.ensureLaunched();
    const transport = this.connection!.getTransport();

    const rawTree = await this._extractor.extractDomTree(transport);
    const filtered = this._domFilter.filter(rawTree);
    let elements = this._semanticExtractor.extract(filtered);

    if (this.options.compression && this.options.compression.enabled !== false) {
      const compressor = new TokenCompressor(this.options.compression);
      elements = compressor.compress(elements);
    }

    const [titleResult, urlResult] = await Promise.all([
      transport.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }),
      transport.send('Runtime.evaluate', { expression: 'window.location.href', returnByValue: true }),
    ]);

    const title = (titleResult as { result?: { value?: string } })?.result?.value || '';
    const url = (urlResult as { result?: { value?: string } })?.result?.value || '';

    const graph = this.graphBuilder.build(elements, url, title);

    // Sync agentDomBuilder's idMap so act() works with graph node IDs
    this.agentDomBuilder.build(elements, url, title);

    return graph;
  }

  async actions(): Promise<SemanticAction[]> {
    this.ensureLaunched();
    const graph = await this.observeGraph();
    return this.actionGenerator.generate(graph);
  }

  async perform(actionId: string, params?: Record<string, string>): Promise<ActSemanticResult> {
    this.ensureLaunched();
    const allActions = await this.actions();
    const action = allActions.find(a => a.id === actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}. Available: ${allActions.map(a => a.id).join(', ')}`);
    }

    // Fill params
    if (params) {
      for (const param of action.params) {
        const value = params[param.name];
        if (value !== undefined) {
          await this.act(param.nodeId, 'fill', value);
        }
      }
    }

    // Click trigger
    await this.act(action.triggerNodeId, 'click');

    return {
      success: true,
      actionId: action.id,
      actionType: action.type,
    };
  }

  async act(agentId: number, action: 'click' | 'fill', value?: string): Promise<ActResult> {
    this.ensureLaunched();
    const backendNodeId = this.agentDomBuilder.resolveAgentId(agentId);
    if (backendNodeId === undefined) {
      throw new Error(`Agent DOM ID ${agentId} not found. Call observe() first to get current Agent DOM.`);
    }

    if (action === 'click') {
      await this.controller!.clickByBackendNodeId(backendNodeId);
    } else if (action === 'fill') {
      if (value === undefined) {
        throw new Error('value is required for fill action');
      }
      await this.controller!.fillByBackendNodeId(backendNodeId, value);
    }

    return { success: true, action, agentId };
  }

  async click(agentId: number): Promise<ActResult> {
    return this.act(agentId, 'click');
  }

  async fill(agentId: number, value: string): Promise<ActResult> {
    return this.act(agentId, 'fill', value);
  }

  /** Human-like typing: types character by character with random delays (50-150ms). */
  async fillHuman(agentId: number, value: string): Promise<ActResult> {
    this.ensureLaunched();
    const backendNodeId = this.agentDomBuilder.resolveAgentId(agentId);
    if (backendNodeId === undefined) {
      throw new Error(`Agent DOM ID ${agentId} not found. Call observe() first to get current Agent DOM.`);
    }
    await this.controller!.fillHumanByBackendNodeId(backendNodeId, value);
    return { success: true, action: 'fill', agentId };
  }

  /**
   * Fill by CSS selector — bypasses agentId. Uses human-like typing.
   * Works with WebSquare, custom widgets, or any framework.
   * Selector can be CSS selector or #id (e.g., '#myInput', '.w2input', '[data-id="field1"]').
   */
  async fillBySelector(selector: string, value: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.fillBySelector(selector, value);
    return { success: true, action: 'fill', agentId: -1, selector };
  }

  /**
   * Click by CSS selector — bypasses agentId.
   * Works with WebSquare, custom widgets, or any framework.
   */
  async clickBySelector(selector: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.clickBySelector(selector);
    return { success: true, action: 'click', agentId: -1, selector };
  }

  /**
   * Focus an element by CSS selector.
   * Useful before type() to direct keyboard input to a specific element.
   */
  async focusBySelector(selector: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.focusBySelector(selector);
    return { success: true, action: 'focus', agentId: -1, selector };
  }

  /**
   * Type text character-by-character into the currently focused element.
   * Framework-agnostic: sends real CDP keyboard events.
   * Use focusBySelector() first to target a specific element.
   */
  async type(text: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.type(text);
    return { success: true, action: 'type', agentId: -1 };
  }

  /**
   * Press a special key (Enter, Tab, Backspace, Escape, arrows, etc.).
   */
  async pressKey(key: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.pressKey(key);
    return { success: true, action: 'press-key', agentId: -1 };
  }

  /** Select a <select> option by visible text or value. */
  async selectOption(agentId: number, optionValue: string): Promise<ActResult> {
    this.ensureLaunched();
    const backendNodeId = this.agentDomBuilder.resolveAgentId(agentId);
    if (backendNodeId === undefined) {
      throw new Error(`Agent DOM ID ${agentId} not found. Call observe() first to get current Agent DOM.`);
    }
    await this.controller!.selectByBackendNodeId(backendNodeId, optionValue);
    return { success: true, action: 'select', agentId };
  }

  /** Navigate back in browser history. */
  async goBack(): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.goBack();
    return { success: true, action: 'back', agentId: -1 };
  }

  /** Navigate forward in browser history. */
  async goForward(): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.goForward();
    return { success: true, action: 'forward', agentId: -1 };
  }

  /** Hover over an element by agentId. Triggers mouseover/mouseenter events. */
  async hover(agentId: number): Promise<ActResult> {
    this.ensureLaunched();
    const backendNodeId = this.agentDomBuilder.resolveAgentId(agentId);
    if (backendNodeId === undefined) {
      throw new Error(`Agent DOM ID ${agentId} not found. Call observe() first to get current Agent DOM.`);
    }
    await this.controller!.hoverByBackendNodeId(backendNodeId);
    return { success: true, action: 'hover', agentId };
  }

  /**
   * Scroll the page in a given direction.
   * @param direction - 'up', 'down', 'left', 'right'
   * @param pixels - scroll amount in pixels (default: 300)
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', pixels?: number): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.scroll(direction, pixels);
    return { success: true, action: 'scroll', agentId: -1 };
  }

  /**
   * Wait for a CSS selector to appear in the DOM.
   * @param selector - CSS selector to wait for
   * @param timeout - max wait time in ms (default: 5000)
   * @returns whether the selector was found
   */
  async waitForSelector(selector: string, timeout?: number): Promise<{ success: boolean; found: boolean; selector: string }> {
    this.ensureLaunched();
    const found = await this.controller!.waitForSelector(selector, timeout);
    return { success: true, found, selector };
  }

  async extract(type: 'text' | 'links' | 'all'): Promise<ExtractResult> {
    this.ensureLaunched();
    const transport = this.connection!.getTransport();

    // Fast path: use lightweight JS extraction for text/links instead of full DOM pipeline
    if (type === 'text') {
      const result = await transport.send('Runtime.evaluate', {
        expression: `(function() {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const texts = [];
          let node;
          while (node = walker.nextNode()) {
            const t = node.textContent.trim();
            if (t && t.length > 1) {
              const style = window.getComputedStyle(node.parentElement);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                texts.push({ text: t.slice(0, 300) });
              }
            }
          }
          return texts.slice(0, 2000);
        })()`,
        returnByValue: true,
      });
      const data = (result as { result?: { value?: unknown } })?.result?.value ?? [];
      return { type, data };
    }

    if (type === 'links') {
      const result = await transport.send('Runtime.evaluate', {
        expression: `(function() {
          const links = Array.from(document.querySelectorAll('a[href]'));
          const seen = new Set();
          return links.reduce(function(acc, a) {
            const href = a.href;
            if (!href || seen.has(href)) return acc;
            seen.add(href);
            const text = (a.textContent || '').trim().slice(0, 200);
            if (text) acc.push({ text: text, href: href });
            return acc;
          }, []).slice(0, 5000);
        })()`,
        returnByValue: true,
      });
      const data = (result as { result?: { value?: unknown } })?.result?.value ?? [];
      return { type, data };
    }

    // type === 'all': full pipeline
    const agentDom = await this.observe();
    return { type, data: agentDom };
  }

  async screenshot(): Promise<ScreenshotResult> {
    this.ensureLaunched();
    const buffer = await this.controller!.screenshot();
    // Parse PNG header for dimensions (width at byte 16, height at byte 20, big-endian uint32)
    let width = 0;
    let height = 0;
    if (buffer.length > 24 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }
    return { buffer, width, height };
  }

  async runJs(script: string): Promise<unknown> {
    this.ensureLaunched();
    return this.controller!.runJs(script);
  }

  async download(url: string, downloadPath?: string): Promise<DownloadResult> {
    this.ensureLaunched();
    const path = downloadPath || this.options.downloadPath || tmpdir();
    return this.controller!.download(url, path);
  }

  /** Set up download behavior to allow downloads to a specific path. */
  async setupDownloads(downloadPath?: string): Promise<void> {
    this.ensureLaunched();
    const path = downloadPath || this.options.downloadPath || tmpdir();
    await this.controller!.setupDownloads(path);
  }

  /** Click an element and wait for a download to complete. */
  async downloadByClick(agentId: number, downloadPath?: string, timeout?: number): Promise<DownloadResult> {
    this.ensureLaunched();
    const backendNodeId = this.agentDomBuilder.resolveAgentId(agentId);
    if (backendNodeId === undefined) {
      throw new Error(`Agent DOM ID ${agentId} not found. Call observe() first to get current Agent DOM.`);
    }
    const path = downloadPath || this.options.downloadPath || tmpdir();
    return this.controller!.downloadByClick(backendNodeId, path, timeout);
  }

  /** Click by JS (run-js based click) and wait for download. Uses setupDownloads + event listeners. */
  async downloadByJs(jsExpression: string, downloadPath?: string, timeout: number = 60000): Promise<DownloadResult> {
    this.ensureLaunched();
    const path = downloadPath || this.options.downloadPath || tmpdir();
    await this.controller!.setupDownloads(path);

    return new Promise<DownloadResult>((resolve, reject) => {
      const transport = this.connection!.getTransport();
      let downloadGuid: string | null = null;
      let filename = '';
      let timeoutTimer: ReturnType<typeof setTimeout>;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        transport.off('Browser.downloadWillBegin', onBegin);
        transport.off('Browser.downloadProgress', onProgress);
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
            filePath: join(path, filename),
            filename,
            size: params.receivedBytes || 0,
          });
        } else if (params.state === 'canceled') {
          cleanup();
          reject(new Error('Download was canceled'));
        }
      };

      transport.on('Browser.downloadWillBegin', onBegin);
      transport.on('Browser.downloadProgress', onProgress);

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`Download timed out after ${timeout}ms`));
      }, timeout);

      // Execute JS to trigger download
      this.controller!.runJs(jsExpression).catch(err => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Search the web using a real browser. Free alternative to search APIs.
   * Supports Google, Naver, Bing, DuckDuckGo, Baidu, Yandex, Yahoo Japan, Ecosia.
   */
  async search(query: string, engine: SearchEngine = 'google'): Promise<SearchResult> {
    this.ensureLaunched();

    const searchUrls: Record<SearchEngine, string> = {
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`,
      naver: `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      duckduckgo: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      baidu: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
      yandex: `https://yandex.ru/search/?text=${encodeURIComponent(query)}`,
      yahoo_japan: `https://search.yahoo.co.jp/search?p=${encodeURIComponent(query)}`,
      ecosia: `https://www.ecosia.org/search?q=${encodeURIComponent(query)}`,
    };

    const url = searchUrls[engine];
    if (!url) {
      throw new Error(`Unsupported search engine: ${engine}. Use: google, naver, bing, duckduckgo, baidu, yandex, yahoo_japan, ecosia`);
    }

    // Use networkIdle for search pages — results are rendered asynchronously
    await this.controller!.goto(url, 'networkIdle');

    // Wait for result elements to appear (up to 5s, 500ms intervals)
    const readySelectors: Record<SearchEngine, string> = {
      google: '#rso',
      naver: '#main_pack',
      bing: '#b_results',
      duckduckgo: '.results',
      baidu: '#content_left',
      yandex: '.serp-list',
      yahoo_japan: '#contents',
      ecosia: '.results',
    };
    const readySel = readySelectors[engine];
    const transport = this.connection!.getTransport();
    for (let i = 0; i < 10; i++) {
      const check = await transport.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${readySel}')`,
        returnByValue: true,
      });
      if ((check as { result?: { value?: boolean } })?.result?.value) break;
      await new Promise(r => setTimeout(r, 500));
    }

    const extractors: Record<SearchEngine, string> = {
      google: `(function() {
        var items = [];
        var seen = new Set();
        document.querySelectorAll('.MjjYud, #search .g, #rso .g, #rso > div').forEach(function(g) {
          var a = g.querySelector('a[href]');
          var h3 = g.querySelector('h3');
          var snippet = g.querySelector('.VwiC3b, [data-sncf], [style*="-webkit-line-clamp"]');
          if (a && h3) {
            var href = a.href;
            if (href && href.indexOf('google.') === -1 && !href.startsWith('/') && !seen.has(href)) {
              seen.add(href);
              items.push({
                title: h3.textContent.trim(),
                url: href,
                snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
              });
            }
          }
        });
        return items.slice(0, 20);
      })()`,

      naver: `(function() {
        var items = [];
        var seen = new Set();
        // Naver renders results in .sc_new sections
        document.querySelectorAll('.sc_new').forEach(function(section) {
          // Skip ad sections
          if (section.querySelector('[class*="_ad_"], [class*="ads_"]')) return;
          // Get all external links in this section
          section.querySelectorAll('a[href]').forEach(function(a) {
            var href = a.href;
            if (!href || seen.has(href)) return;
            // Skip naver internal (except blog/news/cafe), empty text, and UI links
            var text = a.textContent.trim();
            if (text.length < 5) return;
            if (text === 'Keep에 저장' || text === '재시도') return;
            var isNaverInternal = href.indexOf('naver.com') !== -1;
            var isNaverContent = href.indexOf('blog.naver') !== -1 || href.indexOf('news.naver') !== -1 || href.indexOf('cafe.naver') !== -1;
            if (isNaverInternal && !isNaverContent) return;
            // Skip search result page links
            if (href.indexOf('search.naver.com') !== -1) return;
            seen.add(href);
            items.push({
              title: text.slice(0, 200),
              url: href,
              snippet: ''
            });
          });
        });
        // Also try .lst_total for older Naver layout
        if (items.length === 0) {
          document.querySelectorAll('.lst_total > li.bx').forEach(function(bx) {
            if (bx.querySelector('.ad_tit, .alink')) return;
            var a = bx.querySelector('a.link_tit, a.total_tit');
            if (!a || !a.href || seen.has(a.href)) return;
            seen.add(a.href);
            var snippet = bx.querySelector('.dsc_txt, .total_dsc');
            items.push({
              title: a.textContent.trim().slice(0, 200),
              url: a.href,
              snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
            });
          });
        }
        return items.slice(0, 20);
      })()`,

      bing: `(function() {
        var items = [];
        document.querySelectorAll('#b_results .b_algo').forEach(function(el) {
          var a = el.querySelector('h2 a');
          var snippet = el.querySelector('.b_caption p, .b_lineclamp2');
          if (a) {
            // Decode Bing redirect URL: /ck/a?...&u=<base64url>...
            var raw = a.getAttribute('href') || '';
            var url = a.href;
            if (raw.indexOf('/ck/') === 0) {
              var m = raw.match(/[?&]u=a1([^&]+)/);
              if (m) {
                try { url = decodeURIComponent(m[1]); } catch(e) {}
              }
            }
            // Also try cite element for clean URL
            if (url.indexOf('bing.com/ck/') !== -1) {
              var cite = el.querySelector('cite');
              if (cite) {
                var citeUrl = cite.textContent.trim().replace(/\\s.*$/, '');
                if (citeUrl && citeUrl.indexOf('.') !== -1) {
                  url = citeUrl.startsWith('http') ? citeUrl : 'https://' + citeUrl;
                }
              }
            }
            items.push({
              title: a.textContent.trim(),
              url: url,
              snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
            });
          }
        });
        return items.slice(0, 20);
      })()`,

      duckduckgo: `(function() {
        var items = [];
        var seen = new Set();
        document.querySelectorAll('.result.results_links, .result').forEach(function(el) {
          var a = el.querySelector('a.result__a');
          var snippet = el.querySelector('.result__snippet');
          if (!a) return;
          // Decode DuckDuckGo redirect: /l/?uddg=<encoded_url>&...
          var raw = a.getAttribute('href') || '';
          var url = a.href;
          var m = raw.match(/uddg=([^&]+)/);
          if (m) {
            try { url = decodeURIComponent(m[1]); } catch(e) {}
          }
          if (!url || seen.has(url)) return;
          seen.add(url);
          items.push({
            title: a.textContent.trim(),
            url: url,
            snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
          });
        });
        return items.slice(0, 20);
      })()`,

      baidu: `(function() {
        var items = [];
        var seen = new Set();
        document.querySelectorAll('#content_left .result, #content_left .c-container').forEach(function(el) {
          var a = el.querySelector('h3 a, .c-title a');
          var snippet = el.querySelector('.c-abstract, .content-right_8Zs40, .c-span-last');
          if (!a || !a.href) return;
          var url = a.href;
          // Baidu uses redirect URLs like baidu.com/link?url=...
          // The actual URL is only available after click, so we keep the redirect
          // but prefer any visible URL from cite/span
          var cite = el.querySelector('.c-showurl, cite, [class*="source"]');
          if (cite) {
            var citeText = cite.textContent.trim().split(/\\s/)[0];
            if (citeText && citeText.indexOf('.') !== -1 && citeText.indexOf('baidu') === -1) {
              url = citeText.startsWith('http') ? citeText : 'https://' + citeText;
            }
          }
          if (seen.has(url)) return;
          seen.add(url);
          items.push({
            title: a.textContent.trim(),
            url: url,
            snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
          });
        });
        return items.slice(0, 20);
      })()`,

      yandex: `(function() {
        var items = [];
        var seen = new Set();
        document.querySelectorAll('.serp-item').forEach(function(el) {
          var a = el.querySelector('a.OrganicTitle-Link, a[class*="Title"], h2 a');
          var snippet = el.querySelector('.OrganicTextContentSpan, .TextContainer, [class*="Organic"] [class*="Text"]');
          if (!a || !a.href) return;
          var url = a.href;
          // Yandex sometimes uses yabs.yandex redirect
          if (url.indexOf('yabs.yandex') !== -1) {
            var cite = el.querySelector('[class*="Path"] a, .OrganicPath a');
            if (cite && cite.href) url = cite.href;
          }
          if (seen.has(url) || url.indexOf('yandex.') !== -1) return;
          seen.add(url);
          items.push({
            title: a.textContent.trim(),
            url: url,
            snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
          });
        });
        return items.slice(0, 20);
      })()`,

      yahoo_japan: `(function() {
        var items = [];
        var seen = new Set();
        document.querySelectorAll('#contents .sw-Card, #web .w, .algo').forEach(function(el) {
          var a = el.querySelector('a[href]');
          var h3 = el.querySelector('h3, .sw-Card__title, .hd a');
          var snippet = el.querySelector('.sw-Card__description, .dd, p');
          if (!a || !h3) return;
          var url = a.href;
          // Yahoo Japan uses redirect URLs like search.yahoo.co.jp/r/...
          if (url.indexOf('search.yahoo.co.jp/r/') !== -1) {
            // Try to get real URL from data attribute or visible URL
            var dataUrl = a.getAttribute('data-url') || a.getAttribute('data-href');
            if (dataUrl) url = dataUrl;
          }
          if (seen.has(url) || url.indexOf('yahoo.co.jp') !== -1) return;
          seen.add(url);
          items.push({
            title: h3.textContent.trim(),
            url: url,
            snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
          });
        });
        // Broader fallback
        if (items.length === 0) {
          document.querySelectorAll('#contents a[href]').forEach(function(a) {
            var href = a.href;
            if (!href || seen.has(href)) return;
            if (href.indexOf('yahoo.co.jp') !== -1) return;
            if (a.textContent.trim().length < 10) return;
            seen.add(href);
            items.push({ title: a.textContent.trim().slice(0, 200), url: href, snippet: '' });
          });
        }
        return items.slice(0, 20);
      })()`,

      ecosia: `(function() {
        var items = [];
        var seen = new Set();
        document.querySelectorAll('.result').forEach(function(el) {
          var h3 = el.querySelector('h2, h3, .result-title');
          if (!h3) return;
          // Find the actual result link (skip ecosia/google UI links)
          var links = el.querySelectorAll('a[href]');
          var a = null;
          for (var i = 0; i < links.length; i++) {
            var href = links[i].href;
            if (href.indexOf('ecosia.org') === -1 && href.indexOf('google.com') === -1 && href.indexOf('://') !== -1) {
              a = links[i]; break;
            }
          }
          if (!a) return;
          var url = a.href;
          if (seen.has(url)) return;
          seen.add(url);
          var snippet = el.querySelector('.result-snippet, p');
          items.push({
            title: h3.textContent.trim(),
            url: url,
            snippet: snippet ? snippet.textContent.trim().slice(0, 300) : ''
          });
        });
        return items.slice(0, 20);
      })()`,
    };

    const evalResult = await transport.send('Runtime.evaluate', {
      expression: extractors[engine],
      returnByValue: true,
    });

    const results: SearchResultItem[] = (evalResult as { result?: { value?: SearchResultItem[] } })?.result?.value ?? [];

    return {
      success: results.length > 0,
      engine,
      query,
      results,
    };
  }

  // ── Frame (iframe) methods ──

  /** List all child frames (iframes) on the current page. */
  async listFrames(): Promise<unknown> {
    this.ensureLaunched();
    return this.controller!.listFrames();
  }

  /**
   * Observe interactive elements inside a specific iframe.
   * @param target - Frame index (0-based) or URL substring to match.
   */
  async observeFrame(target: string | number): Promise<unknown> {
    this.ensureLaunched();
    return this.controller!.observeFrame(target);
  }

  /**
   * Click an element inside an iframe using absolute coordinate dispatch.
   * @param target - Frame index or URL substring.
   * @param selector - CSS selector within the iframe.
   */
  async clickInFrame(target: string | number, selector: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.clickInFrame(target, selector);
    return { success: true, action: 'click', agentId: -1, selector };
  }

  /**
   * Fill an input inside an iframe.
   * @param target - Frame index or URL substring.
   * @param selector - CSS selector within the iframe.
   * @param text - Text to type.
   */
  async fillInFrame(target: string | number, selector: string, text: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.fillInFrame(target, selector, text);
    return { success: true, action: 'fill', agentId: -1, selector };
  }

  /**
   * Run JavaScript inside an iframe context.
   * @param target - Frame index or URL substring.
   * @param expression - JavaScript to execute.
   */
  async runJsInFrame(target: string | number, expression: string): Promise<unknown> {
    this.ensureLaunched();
    return this.controller!.runJsInFrame(target, expression);
  }

  // ── Shadow DOM methods ──

  /**
   * Observe shadow DOM hosts and their interactive content.
   * Finds all elements with shadowRoot and lists their inner elements + iframes.
   */
  async observeShadow(): Promise<unknown> {
    this.ensureLaunched();
    return this.controller!.observeShadow();
  }

  /**
   * Click an element using shadow-piercing deep query.
   * Selector supports ">>>" to cross shadow DOM boundaries.
   * Example: "#turnstile-widget >>> input[type=checkbox]"
   * Plain CSS selectors also work — will recursively search all shadow roots.
   */
  async clickDeep(selector: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.clickDeep(selector);
    return { success: true, action: 'click', agentId: -1, selector };
  }

  /**
   * Fill an input using shadow-piercing deep query.
   * Selector supports ">>>" to cross shadow DOM boundaries.
   */
  async fillDeep(selector: string, text: string): Promise<ActResult> {
    this.ensureLaunched();
    await this.controller!.fillDeep(selector, text);
    return { success: true, action: 'fill', agentId: -1, selector };
  }

  getSecurityViolations() {
    return this.securityLayer?.getViolations() || [];
  }

  async checkPromptInjection(): Promise<{ injectionDetected: boolean; patterns: string[] }> {
    this.ensureLaunched();
    if (!this.promptGuard) return { injectionDetected: false, patterns: [] };
    const text = await this.runJs('document.body.innerText');
    return this.promptGuard.detect(text as string || '');
  }

  /** 기존 Chrome 인스턴스에 재연결 (포트 기반) */
  async reconnect(port: number): Promise<void> {
    this.connection = new CDPConnection();
    await this.connection.reconnect(port);
    this.controller = new BrowserController(this.connection.getTransport());
  }

  /** WebSocket만 끊고 Chrome은 살려둠 (세션 유지) */
  async detach(): Promise<void> {
    if (this.connection) {
      await this.connection.detach();
      this.connection = null;
      this.controller = null;
    }
  }

  /** launch() 후 연결 정보 반환 (port, pid, wsUrl) */
  getLaunchResult(): LaunchResult | null {
    return this.connection?.getLaunchResult() ?? null;
  }

  async close(): Promise<void> {
    if (this.connection && this.sessionManager) {
      try {
        await this.sessionManager.saveCookies(this.connection.getTransport());
      } catch {
        // Best effort
      }
    }
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
      this.controller = null;
    }
  }

  private ensureLaunched(): void {
    if (!this.connection || !this.controller) {
      throw new Error('Cheliped not launched. Call launch() first.');
    }
  }
}
