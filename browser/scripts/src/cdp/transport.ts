import WebSocket from 'ws';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CDPTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private _connected = false;
  private readonly timeoutMs: number;

  constructor(timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.once('open', () => {
        this._connected = true;
        resolve();
      });

      ws.once('error', (err: Error) => {
        if (!this._connected) {
          reject(err);
        }
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', () => {
        this._connected = false;
        this.rejectAllPending(new Error('WebSocket closed'));
      });

      ws.on('error', (err: Error) => {
        if (this._connected) {
          this.rejectAllPending(err);
        }
      });
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      this.rejectAllPending(new Error('Transport disconnected'));

      if (!this.ws || !this._connected) {
        this._connected = false;
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        this._connected = false;
        try { this.ws?.terminate(); } catch {}
        resolve();
      }, 5000);

      this.ws.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws.close();
    });
  }

  send(method: string, params?: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this._connected) {
        reject(new Error('Not connected'));
        return;
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method} (id=${id})`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const message = JSON.stringify({ id, method, params });
      this.ws.send(message, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  on(event: string, callback: (...args: unknown[]) => void): void {
    let callbacks = this.listeners.get(event);
    if (!callbacks) {
      callbacks = new Set();
      this.listeners.set(event, callbacks);
    }
    callbacks.add(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);

        if (msg.error) {
          const err = msg.error as Record<string, unknown>;
          pending.reject(
            new Error(`CDP error (${String(err.code ?? 'unknown')}): ${String(err.message ?? msg.error)}`)
          );
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if (typeof msg.method === 'string') {
      this.emit(msg.method, msg.params);
    }
  }

  private emit(event: string, params: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(params);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}
