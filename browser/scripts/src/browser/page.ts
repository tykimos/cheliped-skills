import type { GotoResult } from '../types/index.js';
import type { CDPTransport } from '../cdp/transport.js';

export class Page {
  constructor(private transport: CDPTransport) {}

  async navigate(url: string, waitStrategy: 'load' | 'networkIdle' = 'load'): Promise<GotoResult> {
    // Track HTTP status from Network.responseReceived
    let httpStatus = 200;
    let mainFrameId: string | undefined;
    const onResponse = (params: unknown) => {
      const p = params as Record<string, unknown>;
      const response = p.response as Record<string, unknown> | undefined;
      if (response && typeof response.status === 'number') {
        // Only capture the main frame's final document response (skip redirects)
        if (p.type === 'Document' && (!mainFrameId || p.frameId === mainFrameId)) {
          httpStatus = response.status;
        }
      }
    };
    this.transport.on('Network.responseReceived', onResponse);

    try {
      const navResult = await this.transport.send('Page.navigate', { url }) as Record<string, unknown>;
      mainFrameId = navResult.frameId as string | undefined;
      if (waitStrategy === 'networkIdle') {
        await this.waitForNetworkIdle();
      } else {
        await this.waitForLoad();
      }
    } finally {
      this.transport.off('Network.responseReceived', onResponse);
    }

    const title = await this.getTitle();

    return {
      url,
      status: httpStatus,
      title,
    };
  }

  // `graceMs` (PR-B3): the idle window applied BEFORE any network request is seen.
  // For an action that triggers no network at all (e.g. a click on a static page),
  // this lets us settle quickly instead of always paying the full `idleTimeMs`
  // floor. Once any request is observed we revert to the full `idleTimeMs`. It
  // defaults to `idleTimeMs`, so navigation and other callers are unchanged.
  async waitForNetworkIdle(
    idleTimeMs: number = 500,
    timeout: number = 30000,
    graceMs: number = idleTimeMs,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let pendingRequests = 0;
      let sawRequest = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.transport.off('Network.requestWillBeSent', onRequest);
        this.transport.off('Network.loadingFinished', onFinished);
        this.transport.off('Network.loadingFailed', onFailed);
      };

      const checkIdle = () => {
        if (pendingRequests <= 0) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            cleanup();
            resolve();
          }, sawRequest ? idleTimeMs : graceMs);
        }
      };

      const onRequest = () => {
        sawRequest = true;
        pendingRequests++;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      };

      const onFinished = () => {
        pendingRequests = Math.max(0, pendingRequests - 1);
        checkIdle();
      };

      const onFailed = () => {
        pendingRequests = Math.max(0, pendingRequests - 1);
        checkIdle();
      };

      // Set up timeout
      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(); // Resolve on timeout (don't block, just give up waiting)
      }, timeout);

      // Listen to network events
      this.transport.on('Network.requestWillBeSent', onRequest);
      this.transport.on('Network.loadingFinished', onFinished);
      this.transport.on('Network.loadingFailed', onFailed);

      // Check if already idle
      checkIdle();
    });
  }

  async waitForStable(timeoutMs: number = 2000): Promise<void> {
    // Post-action settle: a 150ms grace floor when the action triggers no network
    // (static page), full 500ms idle once any request fires. (PR-B3)
    return this.waitForNetworkIdle(500, timeoutMs, 150);
  }

  async waitForLoad(timeout: number = 30000): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.transport.off('Page.loadEventFired', onLoad);
      };
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(); // Don't block on timeout — best effort like waitForNetworkIdle
      }, timeout);
      this.transport.on('Page.loadEventFired', onLoad);
    });
  }

  async getTitle(): Promise<string> {
    const result = await this.transport.send('Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
    }) as Record<string, unknown>;

    const r = result.result as Record<string, unknown> | undefined;
    if (r && typeof r.value === 'string') {
      return r.value;
    }
    return '';
  }
}
