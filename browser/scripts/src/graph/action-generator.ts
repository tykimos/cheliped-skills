import type { UIGraph, UIGraphNode, UIFormGroup } from './ui-graph.types.js';
import type { SemanticAction, ActionParam, SemanticActionType } from './action.types.js';

export class ActionGenerator {
  generate(graph: UIGraph): SemanticAction[] {
    const actions: SemanticAction[] = [];
    actions.push(...this.generateLoginActions(graph));
    actions.push(...this.generateSearchActions(graph));
    actions.push(...this.generateFormActions(graph));
    actions.push(...this.generateNavigationActions(graph));
    actions.push(...this.generateClickActions(graph));
    // Filter low-confidence bulk actions, keep only high-value ones
    return actions.filter(a => a.confidence >= 0.7);
  }

  private generateLoginActions(graph: UIGraph): SemanticAction[] {
    const actions: SemanticAction[] = [];

    for (const form of graph.forms) {
      const formInputs = form.inputs.map(id => graph.nodes.find(n => n.id === id)!).filter(Boolean);

      // Check for login pattern: has email/username + password + button
      const emailInput = formInputs.find(n =>
        n.properties.type === 'email' ||
        n.properties.type === 'text' && (
          n.properties.name?.toLowerCase().includes('email') ||
          n.properties.name?.toLowerCase().includes('user') ||
          n.properties.placeholder?.toLowerCase().includes('email') ||
          n.properties.placeholder?.toLowerCase().includes('user')
        )
      );

      const passwordInput = formInputs.find(n => n.properties.type === 'password');

      const submitBtn = form.submitButton ? graph.nodes.find(n => n.id === form.submitButton) : undefined;
      const hasLoginText = submitBtn?.label?.toLowerCase().match(/log\s*in|sign\s*in|로그인/);

      if (emailInput && passwordInput) {
        const params: ActionParam[] = [
          {
            name: emailInput.properties.name || 'email',
            nodeId: emailInput.id,
            type: (emailInput.properties.type as ActionParam['type']) || 'text',
            required: true,
            placeholder: emailInput.properties.placeholder,
          },
          {
            name: passwordInput.properties.name || 'password',
            nodeId: passwordInput.id,
            type: 'password',
            required: true,
            placeholder: passwordInput.properties.placeholder,
          },
        ];

        actions.push({
          id: `login_${form.formId}`,
          type: 'login',
          label: `Login via ${submitBtn?.label || 'form'}`,
          params,
          triggerNodeId: submitBtn?.id || form.formId,
          confidence: hasLoginText ? 0.95 : 0.85,
        });
      }
    }

    return actions;
  }

  private generateSearchActions(graph: UIGraph): SemanticAction[] {
    const actions: SemanticAction[] = [];

    // Look for search patterns
    for (const node of graph.nodes) {
      if (node.type !== 'input') continue;

      const isSearch =
        node.properties.type === 'search' ||
        node.label?.toLowerCase().includes('search') ||
        node.properties.placeholder?.toLowerCase().includes('search') ||
        node.properties.placeholder?.toLowerCase().includes('find') ||
        node.properties.name?.toLowerCase().includes('search') ||
        node.properties.name?.toLowerCase().includes('query') ||
        node.properties.name?.toLowerCase() === 'q';

      if (!isSearch) continue;

      // Find a nearby submit button
      const submitEdge = graph.edges.find(e =>
        e.source === node.id && e.relation === 'submits'
      );
      const triggerNodeId = submitEdge?.target || node.id;

      actions.push({
        id: `search_${node.id}`,
        type: 'search',
        label: `Search: ${node.properties.placeholder || node.label || 'query'}`,
        params: [{
          name: node.properties.name || 'query',
          nodeId: node.id,
          type: 'text',
          required: true,
          placeholder: node.properties.placeholder,
        }],
        triggerNodeId,
        confidence: node.properties.type === 'search' ? 0.95 : 0.8,
      });
    }

    return actions;
  }

  private generateFormActions(graph: UIGraph): SemanticAction[] {
    const actions: SemanticAction[] = [];
    // Skip forms already detected as login or search
    const handledFormIds = new Set<number>();

    for (const form of graph.forms) {
      if (handledFormIds.has(form.formId)) continue;

      const formInputs = form.inputs.map(id => graph.nodes.find(n => n.id === id)!).filter(Boolean);

      // Check if this is already a login form (has password input)
      if (formInputs.some(n => n.properties.type === 'password')) continue;
      // Check if this is already a search form
      if (formInputs.length === 1 && (
        formInputs[0].properties.type === 'search' ||
        formInputs[0].properties.name?.toLowerCase().includes('search') ||
        formInputs[0].properties.name?.toLowerCase() === 'q'
      )) continue;

      const params: ActionParam[] = formInputs.map(n => ({
        name: n.properties.name || n.label || `input_${n.id}`,
        nodeId: n.id,
        type: (n.properties.type as ActionParam['type']) || 'text',
        required: true,
        placeholder: n.properties.placeholder,
      }));

      const submitBtn = form.submitButton ? graph.nodes.find(n => n.id === form.submitButton) : undefined;

      actions.push({
        id: `submit_form_${form.formId}`,
        type: 'submit_form',
        label: `Submit: ${submitBtn?.label || 'form'}`,
        params,
        triggerNodeId: submitBtn?.id || form.formId,
        confidence: submitBtn ? 0.9 : 0.7,
      });
    }

    return actions;
  }

  private generateNavigationActions(graph: UIGraph): SemanticAction[] {
    const actions: SemanticAction[] = [];
    const seenHrefs = new Set<string>();

    for (const node of graph.nodes) {
      if (node.type !== 'link' || !node.properties.href) continue;

      const href = node.properties.href;
      if (seenHrefs.has(href)) continue;
      seenHrefs.add(href);

      actions.push({
        id: `open_link_${node.id}`,
        type: 'open_link',
        label: `${node.label} -> ${node.properties.href}`,
        params: [],
        triggerNodeId: node.id,
        confidence: 0.3,
      });
    }

    return actions;
  }

  private generateClickActions(graph: UIGraph): SemanticAction[] {
    const actions: SemanticAction[] = [];

    for (const node of graph.nodes) {
      if (node.type !== 'button') continue;

      // Skip buttons that are already part of a form (already covered by form actions)
      const isInForm = graph.edges.some(e =>
        e.target === node.id && e.relation === 'contains'
      );
      if (isInForm) continue;

      actions.push({
        id: `click_${node.id}`,
        type: 'click_button',
        label: `Click: ${node.label}`,
        params: [],
        triggerNodeId: node.id,
        confidence: 0.4,
      });
    }

    return actions;
  }
}
