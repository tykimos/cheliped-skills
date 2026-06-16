import { describe, it, expect } from 'vitest';
import { SemanticExtractor } from '../../../src/dom/semantic.js';
import type { InternalDomNode } from '../../../src/types/internal-dom.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 1;

function makeNode(
  tagName: string,
  attributes: Record<string, string> = {},
  children: InternalDomNode[] = [],
  backendNodeId?: number,
): InternalDomNode {
  return {
    backendNodeId: backendNodeId ?? _id++,
    nodeType: 1,
    tagName,
    attributes,
    children,
  };
}

function makeText(content: string): InternalDomNode {
  return {
    backendNodeId: _id++,
    nodeType: 3,
    tagName: '#text',
    attributes: {},
    text: content,
    children: [],
  };
}

const extractor = new SemanticExtractor();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SemanticExtractor', () => {
  it('identifies button elements → category "button"', () => {
    const root = makeNode('div', {}, [makeNode('button', {}, [makeText('Click me')], 42)]);
    const results = extractor.extract(root);
    const btn = results.find((e) => e.category === 'button');
    expect(btn).toBeDefined();
    expect(btn!.category).toBe('button');
    expect(btn!.text).toBe('Click me');
  });

  it('identifies link elements (a with href) → category "link"', () => {
    const root = makeNode('div', {}, [makeNode('a', { href: '/home' }, [makeText('Home')], 10)]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('link');
    expect(results[0].href).toBe('/home');
  });

  it('does NOT identify anchor without href as link', () => {
    const root = makeNode('div', {}, [makeNode('a', {}, [makeText('No href')])]);
    const results = extractor.extract(root);
    expect(results.every((e) => e.category !== 'link')).toBe(true);
  });

  it('identifies input elements → category "input"', () => {
    const root = makeNode('div', {}, [
      makeNode('input', { type: 'email', name: 'email', placeholder: 'Enter email' }, [], 20),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('input');
    expect(results[0].type).toBe('email');
    expect(results[0].placeholder).toBe('Enter email');
    expect(results[0].name).toBe('email');
  });

  it('identifies select elements → category "select"', () => {
    const root = makeNode('div', {}, [
      makeNode('select', { name: 'country' }, [
        makeNode('option', { value: 'us' }, [makeText('US')]),
      ], 30),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('select');
    expect(results[0].name).toBe('country');
  });

  it('identifies textarea elements → category "textarea"', () => {
    const root = makeNode('div', {}, [
      makeNode('textarea', { name: 'message', placeholder: 'Your message' }, [], 40),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('textarea');
    expect(results[0].placeholder).toBe('Your message');
  });

  it('identifies form elements → category "form"', () => {
    const root = makeNode('div', {}, [
      makeNode('form', { action: '/login' }, [], 50),
    ]);
    const results = extractor.extract(root);
    const form = results.find((e) => e.category === 'form');
    expect(form).toBeDefined();
  });

  it('identifies heading text → category "text"', () => {
    const root = makeNode('div', {}, [
      makeNode('h1', {}, [makeText('Welcome')], 60),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('text');
    expect(results[0].text).toBe('Welcome');
  });

  it('identifies paragraph text → category "text"', () => {
    const root = makeNode('div', {}, [
      makeNode('p', {}, [makeText('Test paragraph.')], 61),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('text');
    expect(results[0].text).toBe('Test paragraph.');
  });

  it('identifies img elements → category "image"', () => {
    const root = makeNode('div', {}, [
      makeNode('img', { src: '/logo.png', alt: 'Logo' }, [], 70),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('image');
    expect(results[0].src).toBe('/logo.png');
  });

  it('respects role="button" → category "button"', () => {
    const root = makeNode('div', {}, [
      makeNode('div', { role: 'button', tabindex: '0' }, [makeText('Custom Button')], 80),
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('button');
    expect(results[0].role).toBe('button');
  });

  it('preserves backendNodeId', () => {
    const specificId = 12345;
    const root = makeNode('div', {}, [
      makeNode('button', {}, [makeText('OK')], specificId),
    ]);
    const results = extractor.extract(root);
    expect(results[0].backendNodeId).toBe(specificId);
  });

  it('extracts text content from child text nodes', () => {
    const root = makeNode('div', {}, [
      makeNode('button', {}, [makeText('Save'), makeText(' Changes')], 90),
    ]);
    const results = extractor.extract(root);
    expect(results[0].text).toBe('Save Changes');
  });

  it('extracts href from link', () => {
    const root = makeNode('div', {}, [
      makeNode('a', { href: '/about' }, [makeText('About')], 100),
    ]);
    const results = extractor.extract(root);
    expect(results[0].href).toBe('/about');
  });

  it('extracts placeholder attribute', () => {
    const root = makeNode('div', {}, [
      makeNode('input', { type: 'text', placeholder: 'Search...' }, [], 110),
    ]);
    const results = extractor.extract(root);
    expect(results[0].placeholder).toBe('Search...');
  });

  it('extracts name attribute', () => {
    const root = makeNode('div', {}, [
      makeNode('input', { type: 'text', name: 'username' }, [], 120),
    ]);
    const results = extractor.extract(root);
    expect(results[0].name).toBe('username');
  });

  it('extracts type attribute', () => {
    const root = makeNode('div', {}, [
      makeNode('input', { type: 'password' }, [], 130),
    ]);
    const results = extractor.extract(root);
    expect(results[0].type).toBe('password');
  });

  it('extracts src attribute from img', () => {
    const root = makeNode('div', {}, [
      makeNode('img', { src: '/banner.jpg' }, [], 140),
    ]);
    const results = extractor.extract(root);
    expect(results[0].src).toBe('/banner.jpg');
  });

  it('extracts children inside form elements', () => {
    const root = makeNode('div', {}, [
      makeNode('form', { action: '/search' }, [
        makeNode('input', { type: 'text', name: 'q' }, [], 151),
        makeNode('button', { type: 'submit' }, [makeText('Search')], 152),
      ], 150),
    ]);
    const results = extractor.extract(root);
    // Should have form + input + button
    const categories = results.map((e) => e.category);
    expect(categories).toContain('form');
    expect(categories).toContain('input');
    expect(categories).toContain('button');
  });

  it('does NOT extract span with no text content', () => {
    const root = makeNode('div', {}, [
      makeNode('span', {}, [], 160), // no text children
    ]);
    const results = extractor.extract(root);
    expect(results).toHaveLength(0);
  });
});
