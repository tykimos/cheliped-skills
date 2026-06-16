import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { StoredCookie } from './session.types.js';

export class CookieStore {
  constructor(private cookieFilePath: string) {}

  async save(cookies: StoredCookie[]): Promise<void> {
    await mkdir(dirname(this.cookieFilePath), { recursive: true });
    await writeFile(this.cookieFilePath, JSON.stringify(cookies, null, 2), 'utf-8');
  }

  async load(): Promise<StoredCookie[]> {
    try {
      const data = await readFile(this.cookieFilePath, 'utf-8');
      const cookies: StoredCookie[] = JSON.parse(data);
      // Filter out expired cookies
      const now = Date.now() / 1000;
      return cookies.filter(c => c.expires === -1 || c.expires === 0 || c.expires > now);
    } catch {
      return []; // File doesn't exist yet
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.cookieFilePath);
    } catch {
      // File may not exist
    }
  }
}
