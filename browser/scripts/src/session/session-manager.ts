import { mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { CookieStore } from './cookie-store.js';
import type { SessionConfig, SessionProfile, StoredCookie } from './session.types.js';
import type { CDPTransport } from '../cdp/transport.js';

export class SessionManager {
  private cookieStore: CookieStore | null = null;
  private profile: SessionProfile | null = null;

  constructor(private config: SessionConfig) {}

  async initialize(): Promise<SessionProfile> {
    const profileDir = this.resolveProfileDir();
    await mkdir(profileDir, { recursive: true });

    const cookieFile = join(profileDir, 'cookies.json');
    this.cookieStore = new CookieStore(cookieFile);

    this.profile = {
      name: this.config.profileName || 'default',
      userDataDir: profileDir,
      cookieFile,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    return this.profile;
  }

  async saveCookies(transport: CDPTransport): Promise<void> {
    if (!this.cookieStore || !this.config.persistCookies) return;

    const result = await transport.send('Network.getAllCookies') as Record<string, any>;
    const cookies: StoredCookie[] = (result.cookies || []).map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite || 'Lax',
    }));

    await this.cookieStore.save(cookies);
  }

  async restoreCookies(transport: CDPTransport): Promise<void> {
    if (!this.cookieStore || !this.config.persistCookies) return;

    const cookies = await this.cookieStore.load();
    if (cookies.length === 0) return;

    const cdpCookies = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));

    await transport.send('Network.setCookies', { cookies: cdpCookies });
  }

  async clearSession(): Promise<void> {
    if (this.cookieStore) {
      await this.cookieStore.clear();
    }
  }

  getProfileDir(): string {
    return this.profile?.userDataDir || this.resolveProfileDir();
  }

  isPersistent(): boolean {
    return !!(this.config.profileName || this.config.profileDir);
  }

  private resolveProfileDir(): string {
    if (this.config.profileDir) {
      return this.config.profileDir;
    }
    const name = this.config.profileName || 'default';
    return join(homedir(), '.cheliped', 'profiles', name);
  }
}
