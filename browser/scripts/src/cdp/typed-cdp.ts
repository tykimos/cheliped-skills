import { CDPTransport } from './transport.js';

export class TypedCDP {
  constructor(private transport: CDPTransport) {}

  get dom() {
    const t = this.transport;
    return {
      getDocument(params?: { depth?: number; pierce?: boolean }) {
        return t.send('DOM.getDocument', params);
      },
      querySelector(nodeId: number, selector: string) {
        return t.send('DOM.querySelector', { nodeId, selector });
      },
      getBoxModel(params: { nodeId?: number; backendNodeId?: number }) {
        return t.send('DOM.getBoxModel', params);
      },
      describeNode(params: { nodeId?: number; backendNodeId?: number; depth?: number }) {
        return t.send('DOM.describeNode', params);
      },
      resolveNode(params: { nodeId?: number; backendNodeId?: number }) {
        return t.send('DOM.resolveNode', params);
      },
      enable() {
        return t.send('DOM.enable');
      },
      disable() {
        return t.send('DOM.disable');
      },
    };
  }

  get page() {
    const t = this.transport;
    return {
      navigate(url: string) {
        return t.send('Page.navigate', { url });
      },
      captureScreenshot(params?: { format?: string; quality?: number; clip?: object }) {
        return t.send('Page.captureScreenshot', params);
      },
      enable() {
        return t.send('Page.enable');
      },
      disable() {
        return t.send('Page.disable');
      },
      reload(params?: { ignoreCache?: boolean }) {
        return t.send('Page.reload', params);
      },
    };
  }

  get runtime() {
    const t = this.transport;
    return {
      evaluate(expression: string, opts?: { returnByValue?: boolean; awaitPromise?: boolean }) {
        return t.send('Runtime.evaluate', { expression, ...opts });
      },
      callFunctionOn(params: { functionDeclaration: string; objectId?: string; arguments?: any[]; returnByValue?: boolean }) {
        return t.send('Runtime.callFunctionOn', params);
      },
      enable() {
        return t.send('Runtime.enable');
      },
    };
  }

  get input() {
    const t = this.transport;
    return {
      dispatchMouseEvent(params: { type: string; x: number; y: number; button?: string; clickCount?: number }) {
        return t.send('Input.dispatchMouseEvent', params);
      },
      dispatchKeyEvent(params: { type: string; key?: string; text?: string; code?: string }) {
        return t.send('Input.dispatchKeyEvent', params);
      },
    };
  }

  get network() {
    const t = this.transport;
    return {
      enable() {
        return t.send('Network.enable');
      },
      disable() {
        return t.send('Network.disable');
      },
      setCacheDisabled(cacheDisabled: boolean) {
        return t.send('Network.setCacheDisabled', { cacheDisabled });
      },
      setExtraHTTPHeaders(headers: Record<string, string>) {
        return t.send('Network.setExtraHTTPHeaders', { headers });
      },
      getAllCookies() {
        return t.send('Network.getAllCookies');
      },
      setCookies(cookies: any[]) {
        return t.send('Network.setCookies', { cookies });
      },
      clearBrowserCookies() {
        return t.send('Network.clearBrowserCookies');
      },
      setBlockedURLs(urls: string[]) {
        return t.send('Network.setBlockedURLs', { urls });
      },
    };
  }

  get browser() {
    const t = this.transport;
    return {
      getVersion() {
        return t.send('Browser.getVersion');
      },
      setDownloadBehavior(behavior: 'deny' | 'allow' | 'allowAndName' | 'default', downloadPath?: string, eventsEnabled?: boolean) {
        return t.send('Browser.setDownloadBehavior', { behavior, downloadPath, eventsEnabled });
      },
    };
  }

  get fetch() {
    const t = this.transport;
    return {
      enable(params?: { patterns?: any[] }) {
        return t.send('Fetch.enable', params);
      },
      disable() {
        return t.send('Fetch.disable');
      },
      failRequest(requestId: string, reason: string) {
        return t.send('Fetch.failRequest', { requestId, errorReason: reason });
      },
      continueRequest(requestId: string) {
        return t.send('Fetch.continueRequest', { requestId });
      },
    };
  }

  // Pass-through to raw transport for events
  on(event: string, callback: (...args: any[]) => void) {
    this.transport.on(event, callback);
  }

  off(event: string, callback: (...args: any[]) => void) {
    this.transport.off(event, callback);
  }

  // Raw send for anything not covered by typed methods
  send(method: string, params?: object) {
    return this.transport.send(method, params);
  }
}
