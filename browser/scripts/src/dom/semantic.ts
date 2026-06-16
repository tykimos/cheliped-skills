import type { InternalDomNode, SemanticElement } from '../types/internal-dom.types.js';

const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'td', 'th', 'label', 'span',
  'blockquote', 'figcaption',
  'dt', 'dd', 'caption', 'summary', 'address', 'pre',
]);

const ROLE_CATEGORY_MAP: Record<string, SemanticElement['category']> = {
  button: 'button',
  link: 'link',
  textbox: 'input',
  checkbox: 'input',
  radio: 'input',
};

export class SemanticExtractor {
  extract(node: InternalDomNode): SemanticElement[] {
    const results: SemanticElement[] = [];
    // Document node (nodeType 9) — recurse into children directly
    if (node.nodeType !== 1) {
      for (const child of node.children) {
        this.walk(child, results);
      }
    } else {
      this.walk(node, results);
    }
    return this.deduplicateTexts(this.deduplicateHeadings(results));
  }

  private deduplicateHeadings(elements: SemanticElement[]): SemanticElement[] {
    const seenHeadingTexts = new Set<string>();
    return elements.filter((el) => {
      // Only deduplicate actual text-category headings, not links/buttons that wrap headings
      if (!el.tag || el.category !== 'text') return true;
      const text = (el.text ?? '').trim();
      if (!text) return false; // drop empty headings
      if (seenHeadingTexts.has(text)) return false; // duplicate
      seenHeadingTexts.add(text);
      return true;
    });
  }

  /** Remove non-heading text elements with duplicate text content. Headings are preserved. */
  private deduplicateTexts(elements: SemanticElement[]): SemanticElement[] {
    const seenTexts = new Set<string>();
    return elements.filter((el) => {
      if (el.category !== 'text') return true;
      if (el.tag) return true; // preserve headings (h1-h6)
      const text = (el.text ?? '').trim();
      if (!text) return false;
      if (seenTexts.has(text)) return false;
      seenTexts.add(text);
      return true;
    });
  }

  private walk(node: InternalDomNode, results: SemanticElement[], currentFormId?: number): void {
    // Only process element nodes
    if (node.nodeType !== 1) return;

    const el = this.tryExtract(node);
    if (el) {
      // Track form context: if this element is inside a form, record the formBackendNodeId
      if (currentFormId !== undefined && el.category !== 'form') {
        el.formBackendNodeId = currentFormId;
      }
      results.push(el);
      // If a link wraps a heading (e.g. <a><h2>Title</h2></a>), preserve heading tag
      if (el.category === 'link' && !el.tag) {
        const headingTag = this.findHeadingTag(node);
        if (headingTag) el.tag = headingTag;
      }

      // Recurse into text-category containers (p, li, td, etc.) and forms
      // to find interactive elements (links, buttons) nested within them.
      // Skip recursing into leaves like button, input, a, img to avoid duplicates.
      const shouldRecurse =
        el.category === 'text' || el.category === 'form';
      if (shouldRecurse) {
        // When entering a form, pass its backendNodeId as the current form context
        const nextFormId = el.category === 'form' ? el.backendNodeId : currentFormId;
        for (const child of node.children) {
          this.walk(child, results, nextFormId);
        }
      }
      return;
    }

    for (const child of node.children) {
      this.walk(child, results, currentFormId);
    }
  }

  private tryExtract(node: InternalDomNode): SemanticElement | null {
    const { tagName, attributes, backendNodeId } = node;
    const role = attributes['role'];

    let category: SemanticElement['category'] | null = null;

    // Determine category by tag name
    if (tagName === 'button') {
      category = 'button';
    } else if (tagName === 'a' && attributes['href'] !== undefined) {
      category = 'link';
    } else if (tagName === 'input') {
      category = 'input';
    } else if (tagName === 'select') {
      category = 'select';
    } else if (tagName === 'textarea') {
      category = 'textarea';
    } else if (tagName === 'form') {
      category = 'form';
    } else if (tagName === 'img') {
      category = 'image';
    } else if (TEXT_TAGS.has(tagName)) {
      category = 'text';
    }

    // Override / set by ARIA role
    if (role && ROLE_CATEGORY_MAP[role]) {
      category = ROLE_CATEGORY_MAP[role];
    }

    // span with text only matters if it actually has text
    if (tagName === 'span' && category === 'text') {
      const text = this.getTextContent(node);
      if (!text) return null;
    }

    if (!category) return null;

    const text = this.getTextContent(node);

    const el: SemanticElement = {
      backendNodeId,
      category,
    };

    el.text = text;
    if (attributes['placeholder']) el.placeholder = attributes['placeholder'];
    if (attributes['href']) el.href = attributes['href'];
    if (attributes['src']) el.src = attributes['src'];
    if (attributes['name']) el.name = attributes['name'];
    if (attributes['value']) el.value = attributes['value'];
    if (attributes['type']) el.type = attributes['type'];
    if (/^h[1-6]$/.test(tagName)) el.tag = tagName;
    if (role) el.role = role;
    if (Object.keys(attributes).length > 0) el.attributes = { ...attributes };

    return el;
  }

  /** Find a heading tag (h1-h6) among the immediate or nested children of a node. */
  private findHeadingTag(node: InternalDomNode): string | null {
    for (const child of node.children) {
      if (child.nodeType === 1 && /^h[1-6]$/.test(child.tagName)) {
        return child.tagName;
      }
      // Check one level deeper (e.g. <a><div><h2>...</h2></div></a>)
      const nested = this.findHeadingTag(child);
      if (nested) return nested;
    }
    return null;
  }

  private getTextContent(node: InternalDomNode): string {
    const parts: string[] = [];
    this.collectText(node, parts);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private collectText(node: InternalDomNode, parts: string[]): void {
    if (node.nodeType === 3 && node.text) {
      const trimmed = node.text.trim();
      if (trimmed) parts.push(trimmed);
      return;
    }
    for (const child of node.children) {
      this.collectText(child, parts);
    }
  }
}
