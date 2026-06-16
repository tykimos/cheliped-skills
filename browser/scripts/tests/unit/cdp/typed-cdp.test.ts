import { describe, it, expect, vi } from 'vitest';
import { TypedCDP } from '../../../src/cdp/typed-cdp.js';

describe('TypedCDP', () => {
  function createMockTransport() {
    return {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
    } as any;
  }

  it('dom.getDocument delegates to transport.send', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.dom.getDocument({ depth: -1 });
    expect(transport.send).toHaveBeenCalledWith('DOM.getDocument', { depth: -1 });
  });

  it('page.navigate delegates correctly', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.page.navigate('https://example.com');
    expect(transport.send).toHaveBeenCalledWith('Page.navigate', { url: 'https://example.com' });
  });

  it('runtime.evaluate delegates correctly', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.runtime.evaluate('1+1', { returnByValue: true });
    expect(transport.send).toHaveBeenCalledWith('Runtime.evaluate', { expression: '1+1', returnByValue: true });
  });

  it('network.getAllCookies delegates correctly', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.network.getAllCookies();
    expect(transport.send).toHaveBeenCalledWith('Network.getAllCookies');
  });

  it('browser.setDownloadBehavior delegates correctly', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.browser.setDownloadBehavior('allow', '/tmp', true);
    expect(transport.send).toHaveBeenCalledWith('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp', eventsEnabled: true });
  });

  it('on/off delegate to transport', () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    const cb = () => {};
    cdp.on('event', cb);
    expect(transport.on).toHaveBeenCalledWith('event', cb);
    cdp.off('event', cb);
    expect(transport.off).toHaveBeenCalledWith('event', cb);
  });

  it('dom.querySelector delegates correctly', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.dom.querySelector(1, '#main');
    expect(transport.send).toHaveBeenCalledWith('DOM.querySelector', { nodeId: 1, selector: '#main' });
  });

  it('network.setCacheDisabled delegates correctly', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.network.setCacheDisabled(true);
    expect(transport.send).toHaveBeenCalledWith('Network.setCacheDisabled', { cacheDisabled: true });
  });

  it('send delegates directly to transport.send', async () => {
    const transport = createMockTransport();
    const cdp = new TypedCDP(transport);
    await cdp.send('Custom.method', { foo: 'bar' });
    expect(transport.send).toHaveBeenCalledWith('Custom.method', { foo: 'bar' });
  });
});
