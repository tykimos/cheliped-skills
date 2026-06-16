// Phase 1 exports
export { Cheliped } from './api/cheliped.js';
export type { AgentDom, AgentDomNode } from './types/agent-dom.types.js';
export type { ChelipedOptions, LaunchResult, CompressionOptions } from './types/options.types.js';
export type { GotoResult, ActResult, ExtractResult, ScreenshotResult, ObserveResult, DownloadResult, ActSemanticResult, SearchResult, SearchResultItem, SearchEngine } from './types/api.types.js';
export type { InternalDomNode, SemanticElement } from './types/internal-dom.types.js';

// Phase 2 exports
export type { UIGraph, UIGraphNode, UIGraphEdge, UIFormGroup, UINodeType, UIEdgeRelation } from './graph/ui-graph.types.js';
export type { SemanticAction, ActionParam, SemanticActionType } from './graph/action.types.js';
export type { SessionConfig, SessionProfile, StoredCookie } from './session/session.types.js';
export type { SecurityPolicy, NetworkPolicy, SecurityViolation } from './security/security.types.js';
export { FrameManager } from './browser/frame-manager.js';
export type { FrameDetail } from './browser/frame-manager.js';
export { UIGraphBuilder } from './graph/ui-graph.js';
export { ActionGenerator } from './graph/action-generator.js';
export { SessionManager } from './session/session-manager.js';
export { SecurityLayer } from './security/security-layer.js';
export { PromptGuard } from './security/prompt-guard.js';
export { ExfiltrationGuard } from './security/exfiltration-guard.js';
export { TokenCompressor, estimateTokens } from './dom/compressor.js';
export { TypedCDP } from './cdp/typed-cdp.js';
