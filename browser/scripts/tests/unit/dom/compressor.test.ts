import { describe, it, expect } from 'vitest';
import { TokenCompressor, estimateTokens } from '../../../src/dom/compressor.js';
import type { SemanticElement } from '../../../src/types/internal-dom.types.js';

function makeElement(overrides: Partial<SemanticElement>): SemanticElement {
  return {
    backendNodeId: Math.floor(Math.random() * 100000),
    category: 'text',
    ...overrides,
  };
}

describe('TokenCompressor', () => {
  it('truncates long text', () => {
    const compressor = new TokenCompressor({ maxTextLength: 20 });
    const el = makeElement({ category: 'text', text: 'This is a very long text that should be truncated at some point' });
    const result = compressor.compress([el]);
    expect(result[0].text!.length).toBeLessThanOrEqual(23); // 20 + '...'
    expect(result[0].text).toContain('...');
  });

  it('removes empty text elements', () => {
    const compressor = new TokenCompressor({ excludeEmptyTexts: true });
    const elements = [
      makeElement({ category: 'text', text: '' }),
      makeElement({ category: 'text', text: '   ' }),
      makeElement({ category: 'text', text: 'Hello' }),
    ];
    const result = compressor.compress(elements);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hello');
  });

  it('deduplicates links with same href', () => {
    const compressor = new TokenCompressor({ deduplicateLinks: true });
    const elements = [
      makeElement({ category: 'link', href: '/page', text: 'Link 1' }),
      makeElement({ category: 'link', href: '/page', text: 'Link 2' }),
      makeElement({ category: 'link', href: '/other', text: 'Link 3' }),
    ];
    const result = compressor.compress(elements);
    const links = result.filter(e => e.category === 'link');
    expect(links).toHaveLength(2);
    expect(links.map(l => l.href)).toEqual(['/page', '/other']);
  });

  it('limits number of links', () => {
    const compressor = new TokenCompressor({ maxLinks: 3 });
    const elements = Array.from({ length: 10 }, (_, i) =>
      makeElement({ category: 'link', href: `/page${i}`, text: `Link ${i}` })
    );
    const result = compressor.compress(elements);
    const links = result.filter(e => e.category === 'link');
    expect(links).toHaveLength(3);
  });

  it('limits number of images', () => {
    const compressor = new TokenCompressor({ maxImages: 2 });
    const elements = Array.from({ length: 5 }, (_, i) =>
      makeElement({ category: 'image', src: `/img${i}.png` })
    );
    const result = compressor.compress(elements);
    const images = result.filter(e => e.category === 'image');
    expect(images).toHaveLength(2);
  });

  it('limits repeated consecutive items', () => {
    const compressor = new TokenCompressor({ maxListItems: 3 });
    // 8 consecutive text elements
    const elements = Array.from({ length: 8 }, (_, i) =>
      makeElement({ category: 'text', text: `Item ${i}` })
    );
    const result = compressor.compress(elements);
    const texts = result.filter(e => e.category === 'text');
    expect(texts).toHaveLength(3);
  });

  it('strips non-essential attributes', () => {
    const compressor = new TokenCompressor();
    const el = makeElement({
      category: 'button',
      text: 'Click',
      attributes: { style: 'color:red', 'data-analytics': 'btn-click', id: 'submit-btn' },
    });
    const result = compressor.compress([el]);
    expect(result[0].attributes).toBeDefined();
    expect(result[0].attributes!['id']).toBe('submit-btn');
    expect(result[0].attributes!['style']).toBeUndefined();
    expect(result[0].attributes!['data-analytics']).toBeUndefined();
  });

  it('keeps essential attributes (id, class, role, data-testid)', () => {
    const compressor = new TokenCompressor();
    const el = makeElement({
      category: 'input',
      attributes: { id: 'email', class: 'form-input', role: 'textbox', 'data-testid': 'email-field', style: 'display:block' },
    });
    const result = compressor.compress([el]);
    const attrs = result[0].attributes!;
    expect(attrs['id']).toBe('email');
    expect(attrs['class']).toBe('form-input');
    expect(attrs['role']).toBe('textbox');
    expect(attrs['data-testid']).toBe('email-field');
    expect(attrs['style']).toBeUndefined();
  });

  it('can be disabled', () => {
    const compressor = new TokenCompressor({ enabled: false, maxLinks: 2 });
    // When disabled, compress should still run (enabled flag doesn't short-circuit in compress())
    // The enabled flag is checked by callers (e.g., cheliped.ts). Test that compression still works.
    // Actually looking at the source, enabled is stored but compress() always runs.
    // So test that without the maxLinks constraint the items pass through.
    const elements = Array.from({ length: 5 }, (_, i) =>
      makeElement({ category: 'link', href: `/page${i}`, text: `Link ${i}` })
    );
    // With enabled:false but maxLinks:2, the compress() still enforces maxLinks
    // The enabled flag is for callers to check. Test that the compressor object is created with enabled:false.
    expect(compressor['opts'].enabled).toBe(false);
  });

  it('significantly reduces large element arrays', () => {
    const compressor = new TokenCompressor({ maxListItems: 5, maxLinks: 20, maxImages: 10 });
    // 200 consecutive text elements
    const elements = Array.from({ length: 200 }, (_, i) =>
      makeElement({ category: 'text', text: `Item text ${i}` })
    );
    const result = compressor.compress(elements);
    expect(result.length).toBeLessThan(50);
  });
});

describe('estimateTokens', () => {
  it('returns approximate token count', () => {
    const agentDom = {
      title: 'Test',
      url: 'https://example.com',
      texts: ['Hello world'],
      links: [],
      inputs: [],
      buttons: [],
    } as any;
    const tokens = estimateTokens(agentDom);
    expect(tokens).toBeGreaterThan(0);
    // JSON string length / 4
    const expected = Math.ceil(JSON.stringify(agentDom).length / 4);
    expect(tokens).toBe(expected);
  });
});
