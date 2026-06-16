import type { SemanticElement } from '../types/internal-dom.types.js';
import type { UIGraph, UIGraphNode, UIGraphEdge, UIFormGroup, UINodeType } from './ui-graph.types.js';

export class UIGraphBuilder {
  private nodeMap = new Map<number, UIGraphNode>(); // backendNodeId -> node

  build(elements: SemanticElement[], url: string, title: string): UIGraph {
    this.nodeMap.clear();
    const nodes = this.buildNodes(elements);
    const edges = this.buildEdges(elements, nodes);
    const forms = this.buildFormGroups(elements, nodes);
    return { url, title, nodes, edges, forms, timestamp: Date.now() };
  }

  private buildNodes(elements: SemanticElement[]): UIGraphNode[] {
    const nodes: UIGraphNode[] = [];
    let nextId = 1;

    for (const el of elements) {
      const node: UIGraphNode = {
        id: nextId++,
        type: el.category as UINodeType,
        label: el.text || el.placeholder || el.name || el.type || '(unnamed)',
        backendNodeId: el.backendNodeId,
        properties: this.buildProperties(el),
      };
      nodes.push(node);
      this.nodeMap.set(el.backendNodeId, node);
    }

    return nodes;
  }

  private buildProperties(el: SemanticElement): Record<string, string> {
    const props: Record<string, string> = {};
    if (el.href) props.href = el.href;
    if (el.src) props.src = el.src;
    if (el.type) props.type = el.type;
    if (el.placeholder) props.placeholder = el.placeholder;
    if (el.name) props.name = el.name;
    if (el.value) props.value = el.value;
    if (el.role) props.role = el.role;
    return props;
  }

  private buildEdges(elements: SemanticElement[], _nodes: UIGraphNode[]): UIGraphEdge[] {
    const edges: UIGraphEdge[] = [];

    // Group elements by form
    const formElements = new Map<number, SemanticElement[]>();
    for (const el of elements) {
      if (el.formBackendNodeId) {
        const list = formElements.get(el.formBackendNodeId) || [];
        list.push(el);
        formElements.set(el.formBackendNodeId, list);
      }
    }

    // 1. Form containment edges (contains)
    for (const [formBnid, children] of formElements) {
      const formNode = this.nodeMap.get(formBnid);
      if (!formNode) continue;
      for (const child of children) {
        const childNode = this.nodeMap.get(child.backendNodeId);
        if (childNode) {
          edges.push({ source: formNode.id, target: childNode.id, relation: 'contains' });
        }
      }
    }

    // 2. Submit edges (submits): inputs -> submit button within same form
    for (const [, children] of formElements) {
      const submitBtn = children.find(c =>
        (c.category === 'button' && (!c.type || c.type === 'submit')) ||
        (c.category === 'button' && c.text?.toLowerCase().includes('submit'))
      );
      if (!submitBtn) continue;
      const submitNode = this.nodeMap.get(submitBtn.backendNodeId);
      if (!submitNode) continue;

      for (const child of children) {
        if (child.category === 'input' || child.category === 'textarea' || child.category === 'select') {
          const inputNode = this.nodeMap.get(child.backendNodeId);
          if (inputNode) {
            edges.push({ source: inputNode.id, target: submitNode.id, relation: 'submits' });
          }
        }
      }
    }

    // 3. Navigation edges (navigates_to): links with href
    for (const el of elements) {
      if (el.category === 'link' && el.href) {
        const node = this.nodeMap.get(el.backendNodeId);
        if (node) {
          edges.push({
            source: node.id,
            target: node.id, // self-reference for navigation
            relation: 'navigates_to',
            metadata: { url: el.href },
          });
        }
      }
    }

    // 4. Next in form (next_in_form): sequential inputs within same form
    for (const [, children] of formElements) {
      const inputs = children.filter(c =>
        c.category === 'input' || c.category === 'textarea' || c.category === 'select'
      );
      for (let i = 0; i < inputs.length - 1; i++) {
        const curr = this.nodeMap.get(inputs[i].backendNodeId);
        const next = this.nodeMap.get(inputs[i + 1].backendNodeId);
        if (curr && next) {
          edges.push({ source: curr.id, target: next.id, relation: 'next_in_form' });
        }
      }
    }

    // 5. Label edges (labels): text elements that might label inputs
    // Match by checking if a text element with "for" attribute targets an input's name
    for (const el of elements) {
      if (el.category === 'text' && el.attributes?.['for']) {
        const targetName = el.attributes['for'];
        const target = elements.find(e =>
          (e.category === 'input' || e.category === 'select' || e.category === 'textarea') &&
          (e.name === targetName || e.attributes?.['id'] === targetName)
        );
        if (target) {
          const labelNode = this.nodeMap.get(el.backendNodeId);
          const targetNode = this.nodeMap.get(target.backendNodeId);
          if (labelNode && targetNode) {
            edges.push({ source: labelNode.id, target: targetNode.id, relation: 'labels' });
          }
        }
      }
    }

    // 6. Trigger edges: buttons with onclick or type=submit
    for (const el of elements) {
      if (el.category === 'button') {
        const node = this.nodeMap.get(el.backendNodeId);
        if (node) {
          edges.push({ source: node.id, target: node.id, relation: 'triggers' });
        }
      }
    }

    return edges;
  }

  private buildFormGroups(elements: SemanticElement[], _nodes: UIGraphNode[]): UIFormGroup[] {
    const groups: UIFormGroup[] = [];
    const formElements = new Map<number, SemanticElement[]>();

    // Find form elements
    const forms = elements.filter(e => e.category === 'form');

    // Group children by form
    for (const el of elements) {
      if (el.formBackendNodeId) {
        const list = formElements.get(el.formBackendNodeId) || [];
        list.push(el);
        formElements.set(el.formBackendNodeId, list);
      }
    }

    for (const form of forms) {
      const formNode = this.nodeMap.get(form.backendNodeId);
      if (!formNode) continue;

      const children = formElements.get(form.backendNodeId) || [];
      const inputNodes = children
        .filter(c => c.category === 'input' || c.category === 'textarea' || c.category === 'select')
        .map(c => this.nodeMap.get(c.backendNodeId)!)
        .filter(Boolean);

      const submitEl = children.find(c =>
        c.category === 'button' && (!c.type || c.type === 'submit')
      );
      const submitNode = submitEl ? this.nodeMap.get(submitEl.backendNodeId) : undefined;

      groups.push({
        formId: formNode.id,
        action: form.attributes?.['action'],
        method: form.attributes?.['method'],
        inputs: inputNodes.map(n => n.id),
        submitButton: submitNode?.id,
      });
    }

    return groups;
  }
}
