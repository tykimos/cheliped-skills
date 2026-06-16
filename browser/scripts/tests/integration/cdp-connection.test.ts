import { describe, it, expect, afterEach } from 'vitest';
import { CDPConnection } from '../../src/cdp/connection.js';

describe('CDP Connection', () => {
  let connection: CDPConnection;

  afterEach(async () => {
    if (connection) {
      await connection.disconnect().catch(() => {});
    }
  });

  it('should connect to Chrome and execute a page-level command', async () => {
    connection = new CDPConnection();
    await connection.connect({ headless: true });

    const transport = connection.getTransport();
    // Runtime.evaluate works on page-level targets
    const result = await transport.send('Runtime.evaluate', {
      expression: 'navigator.userAgent',
      returnByValue: true,
    });

    const value = (result as { result?: { value?: string } })?.result?.value;
    expect(value).toBeDefined();
    expect(typeof value).toBe('string');
    expect(value).toContain('Chrome');
  });

  it('should disconnect cleanly', async () => {
    connection = new CDPConnection();
    await connection.connect({ headless: true });
    await connection.disconnect();

    expect(connection.getTransport().connected).toBe(false);
  });
});
