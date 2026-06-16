/**
 * Internal normalized DOM node representation.
 * This is the ONLY type used after the CDP extraction boundary.
 * All downstream pipeline stages (filter, semantic, agent-dom) operate on this type.
 */
export interface InternalDomNode {
  backendNodeId: number;
  nodeType: number; // 1=Element, 3=Text, 8=Comment, etc.
  tagName: string; // lowercase, e.g. 'div', 'button', '#text'
  attributes: Record<string, string>;
  text?: string; // text content for text nodes or leaf elements
  children: InternalDomNode[];
}

/**
 * Output of the semantic extraction stage.
 * Represents a meaningful element identified from the filtered DOM tree.
 */
export interface SemanticElement {
  backendNodeId: number;
  category: 'button' | 'link' | 'input' | 'form' | 'text' | 'image' | 'select' | 'textarea';
  text?: string;
  placeholder?: string;
  href?: string;
  src?: string;
  name?: string;
  value?: string;
  type?: string; // input type (text, password, email, etc.)
  tag?: string; // original HTML tag name (e.g. 'h1', 'h2', ...)
  role?: string; // ARIA role if present
  attributes?: Record<string, string>;
  formBackendNodeId?: number; // backendNodeId of parent form (for UI Graph)
}
