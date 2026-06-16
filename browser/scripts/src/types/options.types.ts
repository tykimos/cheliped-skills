export interface CompressionOptions {
  enabled?: boolean;
  maxTextLength?: number;
  maxTexts?: number;
  maxListItems?: number;
  maxLinks?: number;
  maxImages?: number;
  excludeEmptyTexts?: boolean;
  deduplicateLinks?: boolean;
}

export interface ChelipedOptions {
  // Phase 1
  chromePath?: string;
  headless?: boolean;
  port?: number;
  viewport?: { width: number; height: number };
  timeout?: number;
  // Phase 2
  compression?: CompressionOptions;
  waitStrategy?: 'load' | 'networkIdle';
  downloadPath?: string;
  // Phase 3: Stealth / Anti-detection
  stealth?: boolean; // Enable all anti-detection measures (default: true)
  session?: {
    profileName?: string;
    profileDir?: string;
    persistCookies?: boolean;
    isolate?: boolean;
  };
  security?: {
    domainAllowlist?: string[];
    domainBlocklist?: string[];
    blockExternalNavigation?: boolean;
    enablePromptGuard?: boolean;
    enableExfiltrationGuard?: boolean;
    maxRedirects?: number;
    blockDownloads?: boolean;
  };
}

export interface LaunchResult {
  wsUrl: string;
  port: number;
  pid: number;
}
