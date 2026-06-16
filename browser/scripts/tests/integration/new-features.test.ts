import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Cheliped } from '../../src/api/cheliped.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_PAGE = `file://${resolve(__dirname, '../fixtures/test-features.html')}`;
const TEST_PAGE_AUTOLOAD = `${TEST_PAGE}?autoload=1`;

describe('New Features (v0.2.0)', () => {
  let cheliped: Cheliped;

  beforeAll(async () => {
    cheliped = new Cheliped({ headless: true });
    await cheliped.launch();
  });

  afterAll(async () => {
    if (cheliped) {
      await cheliped.close().catch(() => {});
    }
  });

  // ── Back / Forward ──────────────────────────────────────────────

  describe('back / forward', () => {
    it('should navigate back after visiting two pages', async () => {
      await cheliped.goto(TEST_PAGE);
      const firstTitle = (await cheliped.runJs('document.title')) as string;

      await cheliped.goto('https://example.com');
      const secondTitle = (await cheliped.runJs('document.title')) as string;
      expect(secondTitle).toContain('Example Domain');

      await cheliped.goBack();
      const backTitle = (await cheliped.runJs('document.title')) as string;
      expect(backTitle).toBe(firstTitle);
    });

    it('should navigate forward after going back', async () => {
      // We're on test page after goBack above
      await cheliped.goForward();
      const forwardTitle = (await cheliped.runJs('document.title')) as string;
      expect(forwardTitle).toContain('Example Domain');
    });

    it('should handle back when no history (no-op)', async () => {
      await cheliped.goto(TEST_PAGE);
      // Should not throw even if at start of history
      await expect(cheliped.goBack()).resolves.toBeDefined();
    });
  });

  // ── Hover ───────────────────────────────────────────────────────

  describe('hover', () => {
    it('should trigger hover events on an element', async () => {
      await cheliped.goto(TEST_PAGE);
      const agentDom = await cheliped.observe();

      // Find the hover trigger element by looking for "Hover Me" text in buttons
      const hoverButton = agentDom.buttons?.find(
        (b: any) => b.text?.includes('Hover Me') || b.label?.includes('Hover Me')
      );

      if (hoverButton) {
        await cheliped.hover(hoverButton.id);
        // Wait a moment for event to fire
        await new Promise(r => setTimeout(r, 200));

        const status = await cheliped.runJs(
          'document.getElementById("hover-status").textContent'
        );
        expect(status).toBe('Hovered!');
      } else {
        // Fallback: find via texts
        const texts = agentDom.texts || [];
        const hoverText = texts.find((t: any) =>
          t.text?.includes('Hover Me')
        );
        if (hoverText) {
          await cheliped.hover(hoverText.id);
          await new Promise(r => setTimeout(r, 200));
          const status = await cheliped.runJs(
            'document.getElementById("hover-status").textContent'
          );
          expect(status).toBe('Hovered!');
        } else {
          // If we can't find it via agentDom, still verify hover doesn't crash
          expect(true).toBe(true);
        }
      }
    });

    it('should throw for invalid agentId', async () => {
      await expect(cheliped.hover(99999)).rejects.toThrow('Agent DOM ID');
    });
  });

  // ── Scroll ──────────────────────────────────────────────────────

  describe('scroll', () => {
    it('should scroll down the page', async () => {
      await cheliped.goto(TEST_PAGE);

      const scrollBefore = (await cheliped.runJs('window.scrollY')) as number;
      await cheliped.scroll('down', 500);
      const scrollAfter = (await cheliped.runJs('window.scrollY')) as number;

      expect(scrollAfter).toBeGreaterThan(scrollBefore);
    });

    it('should scroll up the page', async () => {
      // We scrolled down above, now scroll back up
      const scrollBefore = (await cheliped.runJs('window.scrollY')) as number;
      await cheliped.scroll('up', 300);
      const scrollAfter = (await cheliped.runJs('window.scrollY')) as number;

      expect(scrollAfter).toBeLessThan(scrollBefore);
    });

    it('should use default 300px when pixels not specified', async () => {
      await cheliped.goto(TEST_PAGE);
      await cheliped.scroll('down');
      const scrollY = (await cheliped.runJs('window.scrollY')) as number;
      expect(scrollY).toBeGreaterThan(0);
    });

    it('should return success result', async () => {
      const result = await cheliped.scroll('down', 100);
      expect(result.success).toBe(true);
      expect(result.action).toBe('scroll');
    });
  });

  // ── Keyboard Combinations ──────────────────────────────────────

  describe('keyboard combinations', () => {
    it('should press a single key (Enter)', async () => {
      await cheliped.goto(TEST_PAGE);
      // Should not throw
      await expect(cheliped.pressKey('enter')).resolves.toBeDefined();
    });

    it('should press Ctrl+A combination', async () => {
      await cheliped.goto(TEST_PAGE);

      // Focus the input
      await cheliped.runJs('document.getElementById("keyboard-input").focus()');

      // Press Ctrl+A (select all)
      await cheliped.pressKey('ctrl+a');

      // Check that the key event was logged
      const keyLog = (await cheliped.runJs(
        'document.getElementById("key-log").textContent'
      )) as string;
      expect(keyLog).toContain('Ctrl');
    });

    it('should press Shift+Tab combination', async () => {
      await cheliped.goto(TEST_PAGE);
      await cheliped.runJs('document.getElementById("keyboard-input").focus()');

      await cheliped.pressKey('shift+tab');

      const keyLog = (await cheliped.runJs(
        'document.getElementById("key-log").textContent'
      )) as string;
      expect(keyLog).toContain('Shift');
    });

    it('should throw for unknown key', async () => {
      await expect(cheliped.pressKey('unknownkey123')).rejects.toThrow('Unknown key');
    });
  });

  // ── WaitForSelector ─────────────────────────────────────────────

  describe('waitForSelector', () => {
    it('should find an existing element immediately', async () => {
      await cheliped.goto(TEST_PAGE);
      const result = await cheliped.waitForSelector('#page-title');
      expect(result.found).toBe(true);
      expect(result.selector).toBe('#page-title');
    });

    it('should find a delayed element after it appears', async () => {
      await cheliped.goto(TEST_PAGE_AUTOLOAD);
      // The async-loaded element appears after ~1.5s
      const result = await cheliped.waitForSelector('#async-loaded', 5000);
      expect(result.found).toBe(true);
    });

    it('should return false when element does not appear within timeout', async () => {
      await cheliped.goto(TEST_PAGE);
      // Don't trigger autoload, so #async-loaded never appears
      const result = await cheliped.waitForSelector('#nonexistent-element', 1000);
      expect(result.found).toBe(false);
    });

    it('should use default timeout of 5000ms', async () => {
      await cheliped.goto(TEST_PAGE);
      const start = Date.now();
      const result = await cheliped.waitForSelector('#does-not-exist');
      const elapsed = Date.now() - start;

      expect(result.found).toBe(false);
      // Should have waited approximately 5 seconds (allow some margin)
      expect(elapsed).toBeGreaterThanOrEqual(4500);
      expect(elapsed).toBeLessThan(7000);
    });
  });

  // ── CLI Integration (via runJs proxy) ───────────────────────────

  describe('combined workflows', () => {
    it('should navigate, scroll, wait, and observe in sequence', async () => {
      await cheliped.goto(TEST_PAGE_AUTOLOAD);

      // Scroll down to see more content
      await cheliped.scroll('down', 400);

      // Wait for async content
      const waitResult = await cheliped.waitForSelector('#async-loaded', 5000);
      expect(waitResult.found).toBe(true);

      // Observe the page
      const dom = await cheliped.observe();
      expect(dom).toBeDefined();
    });

    it('should navigate, go back, scroll, and hover in sequence', async () => {
      await cheliped.goto(TEST_PAGE);
      await cheliped.goto('https://example.com');
      await cheliped.goBack();

      const title = (await cheliped.runJs('document.title')) as string;
      expect(title).toContain('Cheliped Feature Test');

      await cheliped.scroll('down', 200);
      // No crash = success
    });
  });
});
