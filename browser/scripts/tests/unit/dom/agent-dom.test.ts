import { describe, it, expect } from 'vitest';
import { AgentDomBuilder } from '../../../src/dom/agent-dom.js';
import type { SemanticElement } from '../../../src/types/internal-dom.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _bnid = 1;

function makeElement(
  category: SemanticElement['category'],
  overrides: Partial<SemanticElement> = {},
): SemanticElement {
  return {
    backendNodeId: _bnid++,
    category,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentDomBuilder', () => {
  it('assigns sequential IDs starting from 1', () => {
    const builder = new AgentDomBuilder();
    const elements: SemanticElement[] = [
      makeElement('button', { text: 'A' }),
      makeElement('link', { href: '/x', text: 'X' }),
      makeElement('input'),
    ];
    const result = builder.build(elements, 'https://example.com', 'Test');
    const allNodes = [
      ...result.buttons,
      ...result.links,
      ...result.inputs,
    ];
    const ids = allNodes.map((n) => n.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('groups elements by type (buttons, links, inputs, etc.)', () => {
    const builder = new AgentDomBuilder();
    const elements: SemanticElement[] = [
      makeElement('button', { text: 'Submit' }),
      makeElement('link', { href: '/home', text: 'Home' }),
      makeElement('input', { name: 'email', type: 'email' }),
      makeElement('select', { name: 'country' }),
      makeElement('textarea', { name: 'msg' }),
      makeElement('form'),
      makeElement('text', { text: 'Hello' }),
      makeElement('image', { src: '/img.png' }),
    ];
    const result = builder.build(elements, 'https://example.com', 'Test');

    expect(result.buttons).toHaveLength(1);
    expect(result.links).toHaveLength(1);
    expect(result.inputs).toHaveLength(1);
    expect(result.selects).toHaveLength(1);
    expect(result.textareas).toHaveLength(1);
    expect(result.forms).toHaveLength(1);
    expect(result.texts).toHaveLength(1);
    expect(result.images).toHaveLength(1);
  });

  it('resolveAgentId returns correct backendNodeId', () => {
    const builder = new AgentDomBuilder();
    const backendId = 9999;
    const elements: SemanticElement[] = [
      makeElement('button', { backendNodeId: backendId, text: 'OK' }),
    ];
    builder.build(elements, 'https://example.com', 'Test');

    // The first element gets agentId=1
    expect(builder.resolveAgentId(1)).toBe(backendId);
  });

  it('resolveAgentId returns undefined for unknown ID', () => {
    const builder = new AgentDomBuilder();
    builder.build([], 'https://example.com', 'Test');
    expect(builder.resolveAgentId(999)).toBeUndefined();
  });

  it('idMap is cleared on rebuild (observe-before-act pattern)', () => {
    const builder = new AgentDomBuilder();
    const firstBackendId = 111;
    builder.build(
      [makeElement('button', { backendNodeId: firstBackendId, text: 'A' })],
      'https://example.com',
      'First',
    );
    // agentId=1 → 111 after first build

    const secondBackendId = 222;
    builder.build(
      [makeElement('button', { backendNodeId: secondBackendId, text: 'B' })],
      'https://example.com',
      'Second',
    );
    // After second build, agentId=1 → 222 (map was cleared and rebuilt)
    expect(builder.resolveAgentId(1)).toBe(secondBackendId);
  });

  it('output includes url, title, timestamp', () => {
    const builder = new AgentDomBuilder();
    const before = Date.now();
    const result = builder.build([], 'https://example.com/page', 'My Page');
    const after = Date.now();

    expect(result.url).toBe('https://example.com/page');
    expect(result.title).toBe('My Page');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('output omits empty arrays for token efficiency (TOK-1)', () => {
    const builder = new AgentDomBuilder();
    const result = builder.build([], 'https://example.com', 'Empty');

    // Empty arrays are intentionally omitted to reduce token count
    expect(result.buttons).toBeUndefined();
    expect(result.links).toBeUndefined();
    expect(result.inputs).toBeUndefined();
    expect(result.selects).toBeUndefined();
    expect(result.textareas).toBeUndefined();
    expect(result.forms).toBeUndefined();
    expect(result.texts).toBeUndefined();
    expect(result.images).toBeUndefined();
  });

  it('output includes non-empty arrays when elements exist', () => {
    const builder = new AgentDomBuilder();
    const elements: SemanticElement[] = [
      makeElement('button', { text: 'OK' }),
      makeElement('link', { href: '/', text: 'Home' }),
    ];
    const result = builder.build(elements, 'https://example.com', 'Test');

    expect(Array.isArray(result.buttons)).toBe(true);
    expect(Array.isArray(result.links)).toBe(true);
    expect(result.inputs).toBeUndefined(); // No inputs → omitted
  });

  it('copies element properties to AgentDomNode correctly', () => {
    const builder = new AgentDomBuilder();
    const elements: SemanticElement[] = [
      makeElement('input', {
        name: 'email',
        type: 'email',
        placeholder: 'Enter email',
      }),
      makeElement('link', {
        href: '/about',
        text: 'About',
      }),
      makeElement('image', {
        src: '/logo.png',
      }),
    ];
    const result = builder.build(elements, 'https://example.com', 'Test');

    expect(result.inputs[0].name).toBe('email');
    expect(result.inputs[0].type).toBe('email');
    expect(result.inputs[0].placeholder).toBe('Enter email');

    expect(result.links[0].href).toBe('https://example.com/about');
    expect(result.links[0].text).toBe('About');

    expect(result.images[0].src).toBe('/logo.png');
  });

  it('does not include undefined properties in AgentDomNode', () => {
    const builder = new AgentDomBuilder();
    const elements: SemanticElement[] = [
      makeElement('button', { text: 'Click' }),
    ];
    const result = builder.build(elements, 'https://example.com', 'Test');
    const btn = result.buttons[0];

    expect('href' in btn).toBe(false);
    expect('src' in btn).toBe(false);
    expect('placeholder' in btn).toBe(false);
  });
});
