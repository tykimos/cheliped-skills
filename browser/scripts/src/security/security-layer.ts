import type { SecurityPolicy, SecurityViolation } from './security.types.js';
import type { CDPTransport } from '../cdp/transport.js';

export class SecurityLayer {
  private violations: SecurityViolation[] = [];
  private initialDomain: string | null = null;

  constructor(private policy: SecurityPolicy) {}

  validateNavigation(url: string): { allowed: boolean; reason?: string } {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;

      // Check allowlist (if set, ONLY these domains are allowed)
      if (this.policy.domainAllowlist && this.policy.domainAllowlist.length > 0) {
        const allowed = this.policy.domainAllowlist.some(pattern => this.matchDomain(domain, pattern));
        if (!allowed) {
          this.recordViolation('domain_blocked', `Domain ${domain} not in allowlist`, url);
          return { allowed: false, reason: `Domain ${domain} not in allowlist` };
        }
      }

      // Check blocklist
      if (this.policy.domainBlocklist && this.policy.domainBlocklist.length > 0) {
        const blocked = this.policy.domainBlocklist.some(pattern => this.matchDomain(domain, pattern));
        if (blocked) {
          this.recordViolation('domain_blocked', `Domain ${domain} is blocklisted`, url);
          return { allowed: false, reason: `Domain ${domain} is blocklisted` };
        }
      }

      // Check external navigation
      if (this.policy.blockExternalNavigation && this.initialDomain) {
        if (domain !== this.initialDomain && !domain.endsWith('.' + this.initialDomain)) {
          this.recordViolation('domain_blocked', `External navigation to ${domain} blocked`, url);
          return { allowed: false, reason: `External navigation to ${domain} blocked` };
        }
      }

      return { allowed: true };
    } catch {
      return { allowed: true }; // Can't parse URL, allow (e.g., about:blank)
    }
  }

  setInitialDomain(url: string): void {
    try {
      this.initialDomain = new URL(url).hostname;
    } catch {
      // ignore
    }
  }

  async attachToTransport(transport: CDPTransport): Promise<void> {
    // Monitor navigation requests
    transport.on('Network.requestWillBeSent', (params: any) => {
      const validation = this.validateNavigation(params.request?.url || '');
      if (!validation.allowed) {
        // We can't cancel individual requests via Network events alone,
        // but we record violations. For actual blocking, use Fetch domain.
      }
    });
  }

  getViolations(): SecurityViolation[] {
    return [...this.violations];
  }

  clearViolations(): void {
    this.violations = [];
  }

  private matchDomain(domain: string, pattern: string): boolean {
    // Exact match
    if (domain === pattern) return true;

    // Wildcard match: *.example.com matches sub.example.com
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return domain === base || domain.endsWith('.' + base);
    }

    // Subdomain match: example.com matches sub.example.com
    return domain.endsWith('.' + pattern);
  }

  private recordViolation(type: SecurityViolation['type'], detail: string, url?: string): void {
    this.violations.push({ type, detail, url, timestamp: Date.now() });
  }
}
