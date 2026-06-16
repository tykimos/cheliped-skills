import { describe, it, expect, afterEach } from 'vitest';
import { Cheliped } from '../../src/api/cheliped.js';

describe('Security Layer Integration', () => {
  let cheliped: Cheliped;

  afterEach(async () => {
    if (cheliped) await cheliped.close().catch(() => {});
  });

  it('should block navigation to non-allowed domains', async () => {
    cheliped = new Cheliped({
      headless: true,
      security: { domainAllowlist: ['example.com'] },
    });
    await cheliped.launch();

    // Allowed
    await expect(cheliped.goto('https://example.com')).resolves.toBeDefined();

    // Blocked
    await expect(cheliped.goto('https://evil.com')).rejects.toThrow(/blocked/i);
  });

  it('should detect prompt injection in page content', async () => {
    cheliped = new Cheliped({
      headless: true,
      security: { enablePromptGuard: true },
    });
    await cheliped.launch();
    await cheliped.goto('https://example.com');

    const result = await cheliped.checkPromptInjection();
    // example.com doesn't have prompt injection
    expect(result.injectionDetected).toBe(false);
  });
});
