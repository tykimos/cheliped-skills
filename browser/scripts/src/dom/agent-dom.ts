import type { SemanticElement } from '../types/internal-dom.types.js';
import type { AgentDom, AgentDomNode } from '../types/agent-dom.types.js';
import type { CDPTransport } from '../cdp/transport.js';
import type { CompressionOptions } from '../types/options.types.js';
import { DomExtractor } from './extractor.js';
import { DomFilter } from './filter.js';
import { SemanticExtractor } from './semantic.js';
import { TokenCompressor } from './compressor.js';

export class AgentDomBuilder {
  private idMap: Map<number, number> = new Map(); // agentId → backendNodeId
  private extractor = new DomExtractor();
  private domFilter = new DomFilter();
  private semanticExtractor = new SemanticExtractor();

  private resolveUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return href;
    }
  }

  build(elements: SemanticElement[], url: string, title: string): AgentDom {
    this.idMap.clear();
    let nextId = 1;

    const buttons: AgentDomNode[] = [];
    const links: AgentDomNode[] = [];
    const inputs: AgentDomNode[] = [];
    const selects: AgentDomNode[] = [];
    const textareas: AgentDomNode[] = [];
    const forms: AgentDomNode[] = [];
    const texts: AgentDomNode[] = [];
    const images: AgentDomNode[] = [];

    for (const el of elements) {
      const agentId = nextId++;
      this.idMap.set(agentId, el.backendNodeId);

      // TOK-5: Only include text if non-empty
      const text = el.text?.trim();
      const node: AgentDomNode = {
        id: agentId,
        ...(text && { text }),
        ...(el.placeholder && { placeholder: el.placeholder }),
        ...(el.href && { href: this.resolveUrl(el.href, url) }),
        ...(el.src && { src: el.src }),
        ...(el.name && { name: el.name }),
        ...(el.value && { value: el.value }),
        ...(el.type && { type: el.type }),
        ...(el.tag && { tag: el.tag }),
      };

      switch (el.category) {
        case 'button': buttons.push(node); break;
        case 'link': links.push(node); break;
        case 'input': inputs.push(node); break;
        case 'select': selects.push(node); break;
        case 'textarea': textareas.push(node); break;
        case 'form': forms.push(node); break;
        case 'text': texts.push(node); break;
        case 'image': images.push(node); break;
      }
    }

    // TOK-1: Only include non-empty arrays to reduce token count
    const result: AgentDom = {
      url,
      title,
      ...(buttons.length > 0 && { buttons }),
      ...(links.length > 0 && { links }),
      ...(inputs.length > 0 && { inputs }),
      ...(selects.length > 0 && { selects }),
      ...(textareas.length > 0 && { textareas }),
      ...(forms.length > 0 && { forms }),
      ...(texts.length > 0 && { texts }),
      ...(images.length > 0 && { images }),
      timestamp: Date.now(),
    };

    return result;
  }

  resolveAgentId(agentId: number): number | undefined {
    return this.idMap.get(agentId);
  }

  async extractAgentDom(
    transport: CDPTransport,
    compression?: CompressionOptions,
    maxDepth?: number,
    includeTiming?: boolean,
  ): Promise<AgentDom & { _timing?: Record<string, number> }> {
    const timing: Record<string, number> = {};
    let t0 = Date.now();

    // Parallelize DOM extraction with title/URL retrieval
    const [rawTree, metaResult] = await Promise.all([
      this.extractor.extractDomTree(transport, maxDepth),
      transport.send('Runtime.evaluate', {
        expression: 'JSON.stringify({t:document.title,u:location.href})',
        returnByValue: true,
      }),
    ]);
    timing.extract = Date.now() - t0;

    const meta = JSON.parse(
      (metaResult as { result?: { value?: string } })?.result?.value ?? '{"t":"","u":""}'
    );
    const titleValue = meta.t ?? '';
    const urlValue = meta.u ?? '';

    t0 = Date.now();
    const filtered = this.domFilter.filter(rawTree);
    timing.filter = Date.now() - t0;

    t0 = Date.now();
    let elements = this.semanticExtractor.extract(filtered);
    timing.semantic = Date.now() - t0;

    // Token compression (Phase 2)
    t0 = Date.now();
    if (compression && compression.enabled !== false) {
      const compressor = new TokenCompressor(compression);
      elements = compressor.compress(elements);
    }
    timing.compress = Date.now() - t0;

    timing.total = Object.values(timing).reduce((a, b) => a + b, 0);

    const result = this.build(elements, urlValue, titleValue);
    if (includeTiming) {
      return { ...result, _timing: timing };
    }
    return result;
  }
}
