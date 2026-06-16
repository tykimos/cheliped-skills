import type { ChelipedOptions, LaunchResult } from '../types/index.js';
import { ChromeLauncher } from './launcher.js';
import { CDPTransport } from './transport.js';

/** JavaScript injected before every page load to mask automation fingerprints. */
const STEALTH_SCRIPT = `
  // 1. Hide navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // 2. Fake plugins (headless Chrome has 0 plugins)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      arr.length = 3;
      return arr;
    },
  });

  // 3. Fake languages
  Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });

  // 4. Fake chrome.runtime (headless lacks this)
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};

  // 5. Override permissions query to hide "denied" automation signals
  const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
  if (origQuery) {
    window.navigator.permissions.query = (params) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return origQuery(params);
    };
  }

  // 6. Patch WebGL vendor/renderer to look like a real GPU
  const origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 0x9245) return 'Intel Inc.';          // UNMASKED_VENDOR_WEBGL
    if (param === 0x9246) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
    return origGetParameter.call(this, param);
  };
`;

export class CDPConnection {
  private launcher: ChromeLauncher;
  private transport: CDPTransport;
  private launchResult: LaunchResult | null = null;
  private ownsProcess: boolean = true;
  private stealthEnabled: boolean = true;

  constructor() {
    this.launcher = new ChromeLauncher();
    this.transport = new CDPTransport();
  }

  async connect(options?: ChelipedOptions, userDataDir?: string): Promise<void> {
    this.stealthEnabled = (options?.stealth !== false);
    this.launchResult = await this.launcher.launch(options ?? {}, userDataDir);
    this.ownsProcess = true;
    await this.transport.connect(this.launchResult.wsUrl);
    await this._enableDomains();
    if (this.stealthEnabled) {
      await this._injectStealth();
    }
  }

  /** 기존 Chrome 인스턴스에 재연결 (포트로 페이지 타겟 검색) */
  async reconnect(port: number): Promise<void> {
    const listUrl = `http://localhost:${port}/json/list`;
    const res = await fetch(listUrl);
    if (!res.ok) throw new Error(`Chrome not reachable on port ${port}`);
    const targets = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
    const pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error(`No page target found on port ${port}`);
    }
    this.ownsProcess = false;
    await this.transport.connect(pageTarget.webSocketDebuggerUrl);
    await this._enableDomains();
    if (this.stealthEnabled) {
      await this._injectStealth();
    }
  }

  getLaunchResult(): LaunchResult | null {
    return this.launchResult;
  }

  getTransport(): CDPTransport {
    return this.transport;
  }

  /** WebSocket만 끊고 Chrome 프로세스는 유지 */
  async detach(): Promise<void> {
    await this.transport.disconnect();
  }

  /** Chrome 프로세스까지 완전 종료 */
  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    if (this.ownsProcess) {
      await this.launcher.kill();
    }
  }

  private async _enableDomains(): Promise<void> {
    await Promise.all([
      this.transport.send('Page.enable'),
      this.transport.send('DOM.enable'),
      this.transport.send('Runtime.enable'),
      this.transport.send('Network.enable'),
    ]);
  }

  /** Inject stealth scripts: runs before every page load and overrides User-Agent. */
  private async _injectStealth(): Promise<void> {
    // 1. Inject stealth JS before every page load via Page.addScriptToEvaluateOnNewDocument
    await this.transport.send('Page.addScriptToEvaluateOnNewDocument', {
      source: STEALTH_SCRIPT,
    });

    // 2. Also inject into the current page immediately
    await this.transport.send('Runtime.evaluate', {
      expression: STEALTH_SCRIPT,
      returnByValue: true,
    }).catch(() => { /* ignore if no page loaded yet */ });

    // 3. Override User-Agent to remove "HeadlessChrome" marker
    try {
      const uaResult = await this.transport.send('Runtime.evaluate', {
        expression: 'navigator.userAgent',
        returnByValue: true,
      }) as Record<string, unknown>;
      const uaObj = uaResult.result as Record<string, unknown>;
      const currentUA = (uaObj?.value as string) || '';
      const cleanUA = currentUA.replace(/HeadlessChrome/g, 'Chrome');
      await this.transport.send('Network.setUserAgentOverride', {
        userAgent: cleanUA,
        acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        platform: 'MacIntel',
      });
    } catch {
      // Best effort — some environments may not support this
    }
  }
}
