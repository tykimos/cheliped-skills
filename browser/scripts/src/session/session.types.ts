export interface SessionConfig {
  profileName?: string;
  profileDir?: string;
  persistCookies?: boolean;
  isolate?: boolean;
}

export interface SessionProfile {
  name: string;
  userDataDir: string;
  cookieFile: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}
