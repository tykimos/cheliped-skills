import { describe, it, expect } from 'vitest';
import { UIGraphBuilder } from '../../../src/graph/ui-graph.js';
import type { SemanticElement } from '../../../src/types/internal-dom.types.js';

describe('UIGraphBuilder', () => {
  it('creates nodes from semantic elements', () => {
    const builder = new UIGraphBuilder();
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'button', text: 'Submit' },
      { backendNodeId: 2, category: 'link', text: 'Home', href: '/home' },
      { backendNodeId: 3, category: 'input', placeholder: 'Email', type: 'email', name: 'email' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].type).toBe('button');
    expect(graph.nodes[0].label).toBe('Submit');
  });

  it('detects form containment via formBackendNodeId', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 10, category: 'form' },
      { backendNodeId: 11, category: 'input', name: 'email', type: 'email', formBackendNodeId: 10 },
      { backendNodeId: 12, category: 'input', name: 'password', type: 'password', formBackendNodeId: 10 },
      { backendNodeId: 13, category: 'button', text: 'Login', type: 'submit', formBackendNodeId: 10 },
    ];
    const builder = new UIGraphBuilder();
    const graph = builder.build(elements, 'https://example.com', 'Test');

    const containsEdges = graph.edges.filter(e => e.relation === 'contains');
    expect(containsEdges.length).toBe(3); // form contains 3 children

    expect(graph.forms).toHaveLength(1);
    expect(graph.forms[0].inputs).toHaveLength(2);
    expect(graph.forms[0].submitButton).toBeDefined();
  });

  it('creates navigates_to edges for links', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'link', text: 'About', href: '/about' },
    ];
    const builder = new UIGraphBuilder();
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const navEdges = graph.edges.filter(e => e.relation === 'navigates_to');
    expect(navEdges).toHaveLength(1);
    expect(navEdges[0].metadata?.url).toBe('/about');
  });

  it('creates next_in_form edges for sequential inputs', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 10, category: 'form' },
      { backendNodeId: 11, category: 'input', name: 'first', formBackendNodeId: 10 },
      { backendNodeId: 12, category: 'input', name: 'last', formBackendNodeId: 10 },
      { backendNodeId: 13, category: 'input', name: 'email', formBackendNodeId: 10 },
    ];
    const builder = new UIGraphBuilder();
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const nextEdges = graph.edges.filter(e => e.relation === 'next_in_form');
    expect(nextEdges).toHaveLength(2); // first->last, last->email
  });

  it('includes url and title in graph', () => {
    const builder = new UIGraphBuilder();
    const graph = builder.build([], 'https://example.com', 'My Title');
    expect(graph.url).toBe('https://example.com');
    expect(graph.title).toBe('My Title');
  });

  it('assigns sequential ids to nodes', () => {
    const builder = new UIGraphBuilder();
    const elements: SemanticElement[] = [
      { backendNodeId: 100, category: 'button', text: 'A' },
      { backendNodeId: 200, category: 'button', text: 'B' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    expect(graph.nodes[0].id).toBe(1);
    expect(graph.nodes[1].id).toBe(2);
  });

  it('uses placeholder or name as label when text is absent', () => {
    const builder = new UIGraphBuilder();
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'input', placeholder: 'Search here', name: 'q', type: 'search' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    expect(graph.nodes[0].label).toBe('Search here');
  });
});
