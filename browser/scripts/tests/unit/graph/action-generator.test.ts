import { describe, it, expect } from 'vitest';
import { UIGraphBuilder } from '../../../src/graph/ui-graph.js';
import { ActionGenerator } from '../../../src/graph/action-generator.js';
import type { SemanticElement } from '../../../src/types/internal-dom.types.js';

describe('ActionGenerator', () => {
  const builder = new UIGraphBuilder();
  const generator = new ActionGenerator();

  it('generates login action from login form', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 10, category: 'form' },
      { backendNodeId: 11, category: 'input', name: 'email', type: 'email', placeholder: 'Email', formBackendNodeId: 10 },
      { backendNodeId: 12, category: 'input', name: 'password', type: 'password', placeholder: 'Password', formBackendNodeId: 10 },
      { backendNodeId: 13, category: 'button', text: 'Log in', type: 'submit', formBackendNodeId: 10 },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);

    const loginAction = actions.find(a => a.type === 'login');
    expect(loginAction).toBeDefined();
    expect(loginAction!.params).toHaveLength(2);
    expect(loginAction!.confidence).toBeGreaterThan(0.8);
  });

  it('generates search action from search input', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'input', name: 'q', type: 'search', placeholder: 'Search...' },
      { backendNodeId: 2, category: 'button', text: 'Search' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);

    const searchAction = actions.find(a => a.type === 'search');
    expect(searchAction).toBeDefined();
    expect(searchAction!.params).toHaveLength(1);
    expect(searchAction!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('open_link actions are generated with low confidence and filtered out by threshold', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'link', text: 'Home', href: '/' },
      { backendNodeId: 2, category: 'link', text: 'About', href: '/about' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);

    // open_link has confidence=0.3, below the 0.7 threshold → filtered out
    const linkActions = actions.filter(a => a.type === 'open_link');
    expect(linkActions).toHaveLength(0);
  });

  it('click_button for standalone buttons is filtered out by confidence threshold', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'button', text: 'Accept Cookies' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);

    // click_button has confidence=0.4, below the 0.7 threshold → filtered out
    const clickAction = actions.find(a => a.type === 'click_button');
    expect(clickAction).toBeUndefined();
  });

  it('generates submit_form for generic forms', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 10, category: 'form' },
      { backendNodeId: 11, category: 'input', name: 'message', type: 'text', formBackendNodeId: 10 },
      { backendNodeId: 12, category: 'button', text: 'Send', type: 'submit', formBackendNodeId: 10 },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);

    const formAction = actions.find(a => a.type === 'submit_form');
    expect(formAction).toBeDefined();
  });

  it('does not generate click_button for form buttons (already in submit_form)', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 10, category: 'form' },
      { backendNodeId: 11, category: 'input', name: 'message', type: 'text', formBackendNodeId: 10 },
      { backendNodeId: 12, category: 'button', text: 'Send', type: 'submit', formBackendNodeId: 10 },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);

    // The Send button is in a form (has contains edge), so no click_button for it
    const clickActions = actions.filter(a => a.type === 'click_button');
    const sendClick = clickActions.find(a => a.label.includes('Send'));
    expect(sendClick).toBeUndefined();
  });

  it('search action has correct param name from input name', () => {
    const elements: SemanticElement[] = [
      { backendNodeId: 1, category: 'input', name: 'q', type: 'search', placeholder: 'Search...' },
    ];
    const graph = builder.build(elements, 'https://example.com', 'Test');
    const actions = generator.generate(graph);
    const searchAction = actions.find(a => a.type === 'search');
    expect(searchAction!.params[0].name).toBe('q');
  });
});
