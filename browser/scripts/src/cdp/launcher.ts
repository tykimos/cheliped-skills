import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net from 'net';
import type { ChelipedOptions, LaunchResult } from '../types/options.types.js';

const CHROME_PATHS: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

interface JsonTarget {
  type: string;
  webSocketDebuggerUrl?: string;
}

async function pollPageTarget(
  port: number,
  timeout: number
): Promise<string> {
  const listUrl = `http://localhost:${port}/json/list`;
  const versionUrl = `http://localhost:${port}/json/version`;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      // First confirm Chrome is up via /json/version
      const versionRes = await fetch(versionUrl);
      if (versionRes.ok) {
        // Then get a page target from /json/list
        const listRes = await fetch(listUrl);
        if (listRes.ok) {
          const targets = (await listRes.json()) as JsonTarget[];
          const pageTarget = targets.find(
            (t) => t.type === 'page' && t.webSocketDebuggerUrl
          );
          if (pageTarget?.webSocketDebuggerUrl) {
            return pageTarget.webSocketDebuggerUrl;
          }
        }
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Chrome did not become ready on port ${port} within ${timeout}ms`
  );
}

export class ChromeLauncher {
  private process: ChildProcess | null = null;
  private userDataDir: string | null = null;
  private persistent: boolean = false;

  static findChrome(chromePath?: string): string {
    if (chromePath) {
      return chromePath;
    }

    const platform = os.platform();
    const candidates = CHROME_PATHS[platform] ?? [];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `Chrome executable not found on platform "${platform}". ` +
        `Tried: ${candidates.join(', ')}. ` +
        `Provide a chromePath in options.`
    );
  }

  async launch(options: ChelipedOptions = {}, userDataDir?: string): Promise<LaunchResult> {
    const chromePath = ChromeLauncher.findChrome(options.chromePath);

    // Use provided userDataDir or create a temp one
    if (userDataDir) {
      this.userDataDir = userDataDir;
      this.persistent = true;
    } else {
      this.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cheliped-'));
      this.persistent = false;
    }

    // Determine port
    let port = options.port ?? 9222;
    if (!(await isPortFree(port))) {
      // Try to find a free port
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          port = typeof addr === 'object' && addr !== null ? addr.port : port;
          server.close(() => resolve());
        });
      });
    }

    const headless = options.headless !== false;
    const timeout = options.timeout ?? 10_000;

    const stealth = options.stealth !== false; // default: true

    const args: string[] = [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      `--user-data-dir=${this.userDataDir}`,
    ];

    // Stealth: anti-detection flags
    if (stealth) {
      args.push(
        '--disable-blink-features=AutomationControlled',
        '--disable-features=AutomationControlled',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--lang=ko-KR,ko',
      );
    }

    if (headless) {
      args.push('--headless=new');
    }

    if (options.viewport) {
      args.push(`--window-size=${options.viewport.width},${options.viewport.height}`);
    } else if (stealth) {
      // Stealth: use a realistic window size instead of default
      args.push('--window-size=1920,1080');
    }

    this.process = spawn(chromePath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: false,
    });

    const pid = this.process.pid;
    if (pid === undefined) {
      throw new Error('Failed to spawn Chrome process');
    }

    // Swallow stderr (just consume so the pipe doesn't block)
    this.process.stderr?.resume();

    this.process.once('error', (err) => {
      throw new Error(`Chrome process error: ${err.message}`);
    });

    const wsUrl = await pollPageTarget(port, timeout);

    return { wsUrl, port, pid };
  }

  async kill(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    if (!this.persistent && this.userDataDir) {
      const dir = this.userDataDir;
      this.userDataDir = null;
      // Wait for Chrome to release file handles
      await new Promise(r => setTimeout(r, 300));
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures — OS will reclaim temp files
      }
    } else {
      this.userDataDir = null;
    }
  }
}
