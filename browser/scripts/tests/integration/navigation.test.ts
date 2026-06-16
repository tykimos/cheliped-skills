import { describe, it, expect, afterEach } from 'vitest';
import { Cheliped } from '../../src/api/cheliped.js';

describe('Navigation', () => {
  let cheliped: Cheliped;

  afterEach(async () => {
    if (cheliped) {
      await cheliped.close().catch(() => {});
    }
  });

  it('should navigate to a page and get title', async () => {
    cheliped = new Cheliped({ headless: true });
    await cheliped.launch();

    const result = await cheliped.goto('https://example.com');
    expect(result.url).toContain('example.com');
    expect(result.title).toContain('Example Domain');
  });

  it('should take a screenshot', async () => {
    cheliped = new Cheliped({ headless: true });
    await cheliped.launch();
    await cheliped.goto('https://example.com');

    const screenshot = await cheliped.screenshot();
    expect(screenshot.buffer).toBeInstanceOf(Buffer);
    expect(screenshot.buffer.length).toBeGreaterThan(0);
  });

  it('should execute JavaScript', async () => {
    cheliped = new Cheliped({ headless: true });
    await cheliped.launch();
    await cheliped.goto('https://example.com');

    const title = await cheliped.runJs('document.title');
    expect(title).toContain('Example Domain');
  });
});
