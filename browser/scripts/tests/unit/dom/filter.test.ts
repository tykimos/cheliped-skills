import { describe, it, expect } from 'vitest';
import { DomFilter } from '../../../src/dom/filter.js';
import type { InternalDomNode } from '../../../src/types/internal-dom.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<InternalDomNode> & { tagName: string }): InternalDomNode {
  return {
    backendNodeId: 0,
    nodeType: 1,
    attributes: {},
    children: [],
    ...overrides,
  };
}

function makeText(content: string): InternalDomNode {
  return {
    backendNodeId: 0,
    nodeType: 3,
    tagName: '#text',
    attributes: {},
    text: content,
    children: [],
  };
}

function makeComment(): InternalDomNode {
  return {
    backendNodeId: 0,
    nodeType: 8,
    tagName: '#comment',
    attributes: {},
    text: 'a comment',
    children: [],
  };
}

/** Wrap a child inside a root div so filter() always has a valid root. */
function wrap(child: InternalDomNode): InternalDomNode {
  return makeNode({ tagName: 'div', id: 999, attributes: { id: 'root' }, children: [child] } as Parameters<typeof makeNode>[0]);
}

const filter = new DomFilter();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DomFilter', () => {
  it('removes script elements', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [makeNode({ tagName: 'script' }), makeNode({ tagName: 'p' })],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('removes style elements', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [makeNode({ tagName: 'style' }), makeNode({ tagName: 'span', attributes: { class: 'x' } })],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('span');
  });

  it('removes noscript elements', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [makeNode({ tagName: 'noscript' }), makeNode({ tagName: 'p' })],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('removes comment nodes (nodeType 8)', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [makeComment(), makeNode({ tagName: 'p' })],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('removes empty/whitespace text nodes', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [makeText('   '), makeText('\n'), makeNode({ tagName: 'p' })],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('keeps non-empty text nodes', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [makeText('Hello world')],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].text).toBe('Hello world');
  });

  it('removes aria-hidden="true" elements', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [
        makeNode({ tagName: 'div', attributes: { 'aria-hidden': 'true' }, children: [makeNode({ tagName: 'span' })] }),
        makeNode({ tagName: 'p' }),
      ],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('removes elements with display:none in inline style', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [
        makeNode({ tagName: 'div', attributes: { style: 'display:none' } }),
        makeNode({ tagName: 'p' }),
      ],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('removes elements with visibility:hidden in inline style', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [
        makeNode({ tagName: 'div', attributes: { style: 'visibility:hidden' } }),
        makeNode({ tagName: 'p' }),
      ],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('removes elements with display: none (with spaces) in inline style', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [
        makeNode({ tagName: 'div', attributes: { style: 'display: none; color: red;' } }),
        makeNode({ tagName: 'p' }),
      ],
    });
    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('keeps SVG node but removes its children', () => {
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [
        makeNode({
          tagName: 'svg',
          children: [
            makeNode({ tagName: 'circle', attributes: { cx: '10', cy: '10', r: '5' } }),
          ],
        }),
      ],
    });
    const result = filter.filter(root);
    // The single-child wrapper collapse should NOT apply here since svg is kept but its child is cleared
    // After filtering, root has one child: svg (with no children)
    // But the root div has id='root' so it has meaningful attributes — no collapse
    const svgNode = result.children.find((c) => c.tagName === 'svg');
    expect(svgNode).toBeDefined();
    expect(svgNode!.children).toHaveLength(0);
  });

  it('collapses single-child wrapper divs with no meaningful attributes', () => {
    const inner = makeNode({ tagName: 'p', attributes: { id: 'inner' }, children: [makeText('Hello')] });
    const wrapper = makeNode({ tagName: 'div', children: [inner] }); // no id/class/role/aria
    const root = makeNode({ tagName: 'div', attributes: { id: 'root' }, children: [wrapper] });

    const result = filter.filter(root);
    // The wrapper div should be collapsed, so root's child should be the p directly
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('p');
  });

  it('does NOT collapse div with meaningful attributes (id)', () => {
    const inner = makeNode({ tagName: 'p', attributes: { id: 'inner' } });
    const wrapper = makeNode({ tagName: 'div', attributes: { id: 'wrapper' }, children: [inner] });
    const root = makeNode({ tagName: 'div', attributes: { id: 'root' }, children: [wrapper] });

    const result = filter.filter(root);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].tagName).toBe('div');
    expect(result.children[0].attributes['id']).toBe('wrapper');
  });

  it('does NOT collapse div with role attribute', () => {
    const inner = makeNode({ tagName: 'p' });
    const wrapper = makeNode({ tagName: 'div', attributes: { role: 'navigation' }, children: [inner] });
    const root = makeNode({ tagName: 'div', attributes: { id: 'root' }, children: [wrapper] });

    const result = filter.filter(root);
    expect(result.children[0].tagName).toBe('div');
  });

  it('does NOT mutate the input tree', () => {
    const child = makeNode({ tagName: 'script' });
    const root = makeNode({
      tagName: 'div',
      attributes: { id: 'root' },
      children: [child],
    });

    const childrenBefore = root.children.length;
    filter.filter(root);

    expect(root.children).toHaveLength(childrenBefore);
    expect(root.children[0]).toBe(child);
  });
});
