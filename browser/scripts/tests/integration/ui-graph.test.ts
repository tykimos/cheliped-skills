import { describe, it, expect, afterEach } from 'vitest';
import { Cheliped } from '../../src/api/cheliped.js';

describe('UI Graph Integration', () => {
  let cheliped: Cheliped;

  afterEach(async () => {
    if (cheliped) await cheliped.close().catch(() => {});
  });

  it('should build UI Graph from a real page', async () => {
    cheliped = new Cheliped({ headless: true });
    await cheliped.launch();
    await cheliped.goto('https://example.com');

    const graph = await cheliped.observeGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.url).toContain('example.com');
    expect(graph.title).toContain('Example');

    // Should have links
    const linkNodes = graph.nodes.filter(n => n.type === 'link');
    expect(linkNodes.length).toBeGreaterThan(0);
  });

  it('should generate semantic actions (low-confidence filtered)', async () => {
    cheliped = new Cheliped({ headless: true });
    await cheliped.launch();
    await cheliped.goto('https://example.com');

    const actions = await cheliped.actions();
    // example.com only has simple links (open_link confidence=0.3)
    // which are below the 0.7 threshold, so no actions are returned
    const linkActions = actions.filter(a => a.type === 'open_link');
    expect(linkActions.length).toBe(0);

    // actions() should still return an array (possibly empty)
    expect(Array.isArray(actions)).toBe(true);
  });
});
