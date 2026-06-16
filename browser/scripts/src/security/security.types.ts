export interface NetworkPolicy {
  blockWebSockets?: boolean;
  blockServiceWorkers?: boolean;
  maxConcurrentRequests?: number;
  requestTimeout?: number;
}

export interface SecurityPolicy {
  domainAllowlist?: string[];
  domainBlocklist?: string[];
  blockExternalNavigation?: boolean;
  enablePromptGuard?: boolean;
  enableExfiltrationGuard?: boolean;
  maxRedirects?: number;
  blockDownloads?: boolean;
  networkPolicy?: NetworkPolicy;
}

export interface SecurityViolation {
  type: 'domain_blocked' | 'prompt_injection' | 'exfiltration' | 'redirect_limit' | 'download_blocked';
  detail: string;
  url?: string;
  timestamp: number;
}
