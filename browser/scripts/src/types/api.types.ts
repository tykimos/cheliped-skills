import type { AgentDom } from './agent-dom.types.js';

export interface GotoResult {
  url: string;
  status: number;
  title: string;
}

export interface ObserveResult {
  agentDom: AgentDom;
}

export interface ActResult {
  success: boolean;
  action: 'click' | 'fill' | 'select' | 'type' | 'focus' | 'press-key' | 'back' | 'forward' | 'hover' | 'scroll';
  agentId: number;
  selector?: string;
}

export interface ExtractResult {
  type: 'text' | 'links' | 'all';
  data: unknown;
}

export interface ScreenshotResult {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface DownloadResult {
  success: boolean;
  filePath: string;
  filename: string;
  size: number;
}

export interface ActSemanticResult {
  success: boolean;
  actionId: string;
  actionType: string;
}

export type SearchEngine = 'google' | 'naver' | 'bing' | 'duckduckgo' | 'baidu' | 'yandex' | 'yahoo_japan' | 'ecosia';

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  success: boolean;
  engine: SearchEngine;
  query: string;
  results: SearchResultItem[];
}
