import type { SecurityPolicy } from './security.types.js';

export class ExfiltrationGuard {
  private allowedDomains: Set<string>;

  constructor(private policy: SecurityPolicy) {
    this.allowedDomains = new Set(policy.domainAllowlist || []);
  }

  validateOutgoingData(url: string, postData?: string): { allowed: boolean; reason?: string } {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;

      // Check if domain is in allowlist (known/trusted)
      const isTrusted = this.isDomainTrusted(domain);

      // Flag POST requests to untrusted domains
      if (!isTrusted && postData && postData.length > 100) {
        return {
          allowed: false,
          reason: `Large POST data (${postData.length} bytes) to untrusted domain: ${domain}`,
        };
      }

      // Flag large query strings to untrusted domains
      if (!isTrusted && parsed.search.length > 500) {
        return {
          allowed: false,
          reason: `Large query string (${parsed.search.length} chars) to untrusted domain: ${domain}`,
        };
      }

      // Flag base64-encoded data in URLs
      if (!isTrusted && /[A-Za-z0-9+/]{50,}={0,2}/.test(parsed.search)) {
        return {
          allowed: false,
          reason: `Possible base64-encoded data in URL to untrusted domain: ${domain}`,
        };
      }

      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }

  private isDomainTrusted(domain: string): boolean {
    if (this.allowedDomains.size === 0) return true; // No allowlist = trust all

    for (const allowed of this.allowedDomains) {
      if (domain === allowed) return true;
      if (allowed.startsWith('*.') && domain.endsWith(allowed.slice(1))) return true;
      if (domain.endsWith('.' + allowed)) return true;
    }
    return false;
  }
}
