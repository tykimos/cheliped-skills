import type { InternalDomNode } from '../../src/types/internal-dom.types.js';

let nextId = 1;

function node(
  tagName: string,
  attributes: Record<string, string>,
  children: InternalDomNode[],
  nodeType = 1,
): InternalDomNode {
  return { backendNodeId: nextId++, nodeType, tagName, attributes, children };
}

function text(content: string): InternalDomNode {
  return { backendNodeId: nextId++, nodeType: 3, tagName: '#text', attributes: {}, text: content, children: [] };
}

/**
 * Manually construct the InternalDomNode tree matching sample-dom.html.
 * IDs are deterministic (reset on each call).
 * This is a test helper — not production code.
 */
export function createSampleDomTree(): InternalDomNode {
  nextId = 1;

  return node('html', {}, [
    node('head', {}, [
      node('title', {}, [text('Test Page')]),
      node('style', {}, [text('body { margin: 0; }')]),
      node('script', {}, [text("console.log('test');")]),
    ]),
    node('body', {}, [
      node('nav', {}, [
        node('a', { href: '/home' }, [text('Home')]),
        node('a', { href: '/about' }, [text('About')]),
      ]),
      node('main', {}, [
        node('h1', {}, [text('Welcome')]),
        node('p', {}, [text('This is a test page.')]),
        node('form', { action: '/login' }, [
          node('label', { for: 'email' }, [text('Email')]),
          node('input', { type: 'email', id: 'email', name: 'email', placeholder: 'Enter email' }, []),
          node('input', { type: 'password', id: 'password', name: 'password', placeholder: 'Enter password' }, []),
          node('button', { type: 'submit' }, [text('Login')]),
        ]),
        node('div', { style: 'display:none' }, [
          node('p', {}, [text('Hidden content')]),
        ]),
        node('div', { 'aria-hidden': 'true' }, [
          node('span', {}, [text('Screen reader hidden')]),
        ]),
        node('div', { role: 'button', tabindex: '0' }, [text('Custom Button')]),
        node('img', { src: '/logo.png', alt: 'Logo' }, []),
        node('select', { name: 'country' }, [
          node('option', { value: 'us' }, [text('US')]),
          node('option', { value: 'kr' }, [text('Korea')]),
        ]),
        node('textarea', { name: 'message', placeholder: 'Your message' }, []),
        node('noscript', {}, [text('Enable JavaScript')]),
        node('svg', {}, [
          node('circle', { cx: '10', cy: '10', r: '5' }, []),
        ]),
      ]),
    ]),
  ]);
}
