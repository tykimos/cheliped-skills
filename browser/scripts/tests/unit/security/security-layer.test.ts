import { describe, it, expect } from 'vitest';
import { SecurityLayer } from '../../../src/security/security-layer.js';

describe('SecurityLayer', () => {
  it('allows navigation when no policy set', () => {
    const layer = new SecurityLayer({});
    expect(layer.validateNavigation('https://example.com').allowed).toBe(true);
  });

  it('blocks domains not in allowlist', () => {
    const layer = new SecurityLayer({ domainAllowlist: ['example.com'] });
    expect(layer.validateNavigation('https://example.com').allowed).toBe(true);
    expect(layer.validateNavigation('https://evil.com').allowed).toBe(false);
  });

  it('blocks domains in blocklist', () => {
    const layer = new SecurityLayer({ domainBlocklist: ['evil.com'] });
    expect(layer.validateNavigation('https://evil.com').allowed).toBe(false);
    expect(layer.validateNavigation('https://good.com').allowed).toBe(true);
  });

  it('supports wildcard domain patterns', () => {
    const layer = new SecurityLayer({ domainAllowlist: ['*.example.com'] });
    expect(layer.validateNavigation('https://sub.example.com').allowed).toBe(true);
    // example.com itself: *.example.com via matchDomain checks domain.endsWith('.example.com') || domain === 'example.com'
    // Looking at matchDomain: pattern = '*.example.com', base = 'example.com'
    // domain === base ('example.com' === 'example.com') → true
    expect(layer.validateNavigation('https://example.com').allowed).toBe(true);
    expect(layer.validateNavigation('https://other.com').allowed).toBe(false);
  });

  it('blocks external navigation', () => {
    const layer = new SecurityLayer({ blockExternalNavigation: true });
    layer.setInitialDomain('https://example.com');
    expect(layer.validateNavigation('https://example.com/page').allowed).toBe(true);
    expect(layer.validateNavigation('https://other.com').allowed).toBe(false);
  });

  it('records violations', () => {
    const layer = new SecurityLayer({ domainBlocklist: ['evil.com'] });
    layer.validateNavigation('https://evil.com');
    expect(layer.getViolations()).toHaveLength(1);
    expect(layer.getViolations()[0].type).toBe('domain_blocked');
  });

  it('clears violations', () => {
    const layer = new SecurityLayer({ domainBlocklist: ['evil.com'] });
    layer.validateNavigation('https://evil.com');
    layer.validateNavigation('https://evil.com');
    expect(layer.getViolations()).toHaveLength(2);
    layer.clearViolations();
    expect(layer.getViolations()).toHaveLength(0);
  });

  it('allows subdomains when parent domain is in allowlist', () => {
    const layer = new SecurityLayer({ domainAllowlist: ['example.com'] });
    // matchDomain: domain.endsWith('.example.com') for sub.example.com → true
    expect(layer.validateNavigation('https://sub.example.com').allowed).toBe(true);
  });

  it('returns reason when blocked', () => {
    const layer = new SecurityLayer({ domainBlocklist: ['evil.com'] });
    const result = layer.validateNavigation('https://evil.com');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('evil.com');
  });
});
