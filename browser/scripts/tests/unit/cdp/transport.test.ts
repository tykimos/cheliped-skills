import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

/**
 * A minimal fake WebSocket that mimics the 'ws' module's WebSocket.
 * It extends EventEmitter so event handling (on/once/emit) works as expected.
 */
class MockWebSocket extends EventEmitter {
  static instance: MockWebSocket | null = null;

  public sentMessages: string[] = [];
  public closed = false;

  constructor(_url: string) {
    super();
    MockWebSocket.instance = this;
    // Defer 'open' so constructor finishes before event fires
    Promise.resolve().then(() => this.emit('open'));
  }

  send(data: string, cb?: (err?: Error) => void): void {
    this.sentMessages.push(data);
    if (cb) cb();
  }

  close(): void {
    this.closed = true;
    Promise.resolve().then(() => this.emit('close'));
  }

  /** Test helper: simulate a message arriving from the server */
  receive(data: object): void {
    this.emit('message', { toString: () => JSON.stringify(data) });
  }
}

// ---------------------------------------------------------------------------
// Inject mock before importing CDPTransport
// ---------------------------------------------------------------------------

vi.mock('ws', () => {
  return { default: MockWebSocket };
});

// Import AFTER mock is registered
const { CDPTransport } = await import('../../../src/cdp/transport.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CDPTransport', () => {
  let transport: InstanceType<typeof CDPTransport>;

  beforeEach(async () => {
    MockWebSocket.instance = null;
    transport = new CDPTransport(500); // short timeout for tests
    await transport.connect('ws://fake-host/json/target');
  });

  afterEach(async () => {
    await transport.disconnect();
  });

  it('message IDs auto-increment', async () => {
    const ws = MockWebSocket.instance!;

    const p1 = transport.send('DOM.getDocument');
    const p2 = transport.send('Runtime.evaluate', { expression: '1+1' });

    const msg1 = JSON.parse(ws.sentMessages[0]) as { id: number; method: string };
    const msg2 = JSON.parse(ws.sentMessages[1]) as { id: number; method: string };

    expect(msg1.id).toBe(1);
    expect(msg2.id).toBe(2);

    // Resolve both so tests don't time out
    ws.receive({ id: 1, result: {} });
    ws.receive({ id: 2, result: { result: { value: 2 } } });

    await Promise.all([p1, p2]);
  });

  it('send() resolves when matching response received', async () => {
    const ws = MockWebSocket.instance!;
    const promise = transport.send('DOM.getDocument');

    ws.receive({ id: 1, result: { root: { nodeId: 1 } } });

    const result = await promise;
    expect(result).toEqual({ root: { nodeId: 1 } });
  });

  it('send() rejects on CDP error response', async () => {
    const ws = MockWebSocket.instance!;
    const promise = transport.send('DOM.notAMethod');

    ws.receive({ id: 1, error: { code: -32601, message: 'Method not found' } });

    await expect(promise).rejects.toThrow('Method not found');
  });

  it('send() rejects on timeout', async () => {
    // Use a very short timeout transport for this test
    const shortTransport = new CDPTransport(50);
    await shortTransport.connect('ws://fake-host/json/target-timeout');

    const promise = shortTransport.send('DOM.getDocument');

    // Do NOT respond — let it timeout
    await expect(promise).rejects.toThrow(/timed out/i);

    await shortTransport.disconnect();
  });

  it('events are emitted to subscribers', async () => {
    const ws = MockWebSocket.instance!;
    const received: unknown[] = [];

    transport.on('Page.loadEventFired', (params) => {
      received.push(params);
    });

    ws.receive({ method: 'Page.loadEventFired', params: { timestamp: 1234.5 } });

    // Give event loop a tick to process
    await Promise.resolve();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ timestamp: 1234.5 });
  });

  it('off() removes event subscribers', async () => {
    const ws = MockWebSocket.instance!;
    const received: unknown[] = [];

    const handler = (params: unknown): void => {
      received.push(params);
    };

    transport.on('Network.requestWillBeSent', handler);
    transport.off('Network.requestWillBeSent', handler);

    ws.receive({ method: 'Network.requestWillBeSent', params: { requestId: 'abc' } });

    await Promise.resolve();

    expect(received).toHaveLength(0);
  });

  it('connected is true after connect and false after disconnect', async () => {
    expect(transport.connected).toBe(true);
    await transport.disconnect();
    expect(transport.connected).toBe(false);
    // Reconnect for afterEach cleanup
    await transport.connect('ws://fake-host/json/reconnect');
  });

  it('send() rejects immediately if not connected', async () => {
    const unconnected = new CDPTransport(500);
    await expect(unconnected.send('DOM.getDocument')).rejects.toThrow('Not connected');
  });

  it('ignores messages that are not valid JSON', async () => {
    const ws = MockWebSocket.instance!;
    // Simulate a garbage message — should not throw
    ws.emit('message', { toString: () => 'not-valid-json{{' });
    // No assertion needed; if it throws, the test will fail
  });

  it('does not resolve send() for a different id', async () => {
    const ws = MockWebSocket.instance!;
    let settled = false;

    transport.send('DOM.getDocument').then(() => { settled = true; }).catch(() => { settled = true; });

    // Respond with a different id
    ws.receive({ id: 999, result: {} });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);

    // Now clean up by responding with the correct id
    ws.receive({ id: 1, result: {} });
    await Promise.resolve();
  });
});
