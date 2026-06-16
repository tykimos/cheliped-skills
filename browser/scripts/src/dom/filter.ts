import type { InternalDomNode } from '../types/internal-dom.types.js';

const REMOVED_TAGS = new Set([
  'script', 'style', 'noscript', 'meta',
  'template', 'iframe',    // iframe content handled separately by extractor
  'path', 'polygon', 'rect', 'circle', 'line', 'ellipse', 'polyline', // SVG internals
]);

function hasMeaningfulAttributes(node: InternalDomNode): boolean {
  const attrs = node.attributes;
  if (attrs['id'] || attrs['class'] || attrs['role']) return true;
  for (const key of Object.keys(attrs)) {
    if (key.startsWith('aria-')) return true;
  }
  return false;
}

function isElementNode(node: InternalDomNode): boolean {
  return node.nodeType === 1;
}

function hasInlineHidden(style: string): boolean {
  // Normalize: remove spaces around colons/semicolons for matching
  const normalized = style.replace(/\s+/g, '').toLowerCase();
  return (
    normalized.includes('display:none') ||
    normalized.includes('visibility:hidden')
  );
}

export class DomFilter {
  filter(node: InternalDomNode): InternalDomNode {
    return this.filterNode(node)!;
  }

  private filterNode(node: InternalDomNode): InternalDomNode | null {
    // Remove comment nodes
    if (node.nodeType === 8) return null;

    // Remove empty text nodes
    if (node.nodeType === 3) {
      if (!node.text || node.text.trim() === '') return null;
      return { ...node, children: [] };
    }

    // Remove disallowed tags
    if (REMOVED_TAGS.has(node.tagName)) return null;

    // Remove link elements that are stylesheets
    if (node.tagName === 'link' && node.attributes['rel'] === 'stylesheet') {
      return null;
    }

    // Remove aria-hidden="true" nodes
    if (node.attributes['aria-hidden'] === 'true') return null;

    // Remove nodes with inline style display:none or visibility:hidden
    const style = node.attributes['style'] ?? '';
    if (style && hasInlineHidden(style)) return null;

    // SVG internals — keep svg node but clear children
    if (node.tagName === 'svg') {
      return { ...node, children: [] };
    }

    // Recursively filter children
    const filteredChildren = node.children
      .map((child) => this.filterNode(child))
      .filter((child): child is InternalDomNode => child !== null);

    let result: InternalDomNode = { ...node, children: filteredChildren };

    // Collapse wrapper divs/spans:
    // If tagName is div or span, has exactly one child element, no text content,
    // and no meaningful attributes → replace with child
    if (result.tagName === 'div' || result.tagName === 'span') {
      const elementChildren = result.children.filter(isElementNode);
      const hasText = result.children.some(
        (c) => c.nodeType === 3 && c.text && c.text.trim() !== ''
      );

      if (
        elementChildren.length === 1 &&
        result.children.length === 1 &&
        !hasText &&
        !hasMeaningfulAttributes(result)
      ) {
        return elementChildren[0];
      }
    }

    return result;
  }
}
