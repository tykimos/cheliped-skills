#!/usr/bin/env node
// cheliped-monitor.mjs — Real-time browser activity monitor
// Streams CDP Page.screencastFrame to a small web viewer via SSE.
//
// Usage: node cheliped-monitor.mjs [--session <name>] [--port <monitor-port>]
// Requires an active cheliped session (Chrome running in background).

import http from 'http';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { exec } from 'child_process';
import WebSocket from 'ws';

const SESSION_FILE_PREFIX = '/tmp/cheliped-session-';
const MONITOR_PID_PREFIX = '/tmp/cheliped-monitor-';
const DEFAULT_MONITOR_PORT = 19222;

// SSE clients
const clients = new Set();
let currentFrame = null;
let lastAction = '';
let frameCount = 0;

async function getTargets(cdpPort) {
  const resp = await fetch(`http://127.0.0.1:${cdpPort}/json`);
  return resp.json();
}

async function getBrowserWsUrl(cdpPort) {
  const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  const data = await resp.json();
  return data.webSocketDebuggerUrl;
}

function startScreencast(browserWsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(browserWsUrl);
    let msgId = 1;
    const pending = new Map();
    let sessionId = null;

    function send(method, params = {}, sid) {
      return new Promise((res, rej) => {
        const id = msgId++;
        const msg = { id, method, params };
        if (sid) msg.sessionId = sid;
        pending.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify(msg));
      });
    }

    ws.on('open', async () => {
      try {
        // Find page target
        const targetsResult = await send('Target.getTargets');
        const targets = targetsResult.targetInfos || [];
        const page = targets.find(t => t.type === 'page');
        if (!page) {
          reject(new Error('No page target found'));
          return;
        }

        // Attach to target (flatten allows multiple clients)
        const attachResult = await send('Target.attachToTarget', {
          targetId: page.targetId,
          flatten: true,
        });
        sessionId = attachResult.sessionId;

        // Start screencast
        await send('Page.startScreencast', {
          format: 'jpeg',
          quality: 50,
          maxWidth: 900,
          maxHeight: 680,
          everyNthFrame: 2,
        }, sessionId);

        resolve(ws);
      } catch (err) {
        reject(err);
      }
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      // Handle RPC responses
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res } = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg.result || {});
        return;
      }

      // Handle screencast frames
      if (msg.method === 'Page.screencastFrame') {
        const params = msg.params;
        currentFrame = params.data;
        frameCount++;

        // Acknowledge frame
        const ackId = msgId++;
        const ackMsg = {
          id: ackId,
          method: 'Page.screencastFrameAck',
          params: { sessionId: params.sessionId || 0 },
        };
        if (msg.sessionId) ackMsg.sessionId = msg.sessionId;
        ws.send(JSON.stringify(ackMsg));

        // Push to SSE clients
        for (const client of clients) {
          client.write(`data: ${JSON.stringify({ frame: params.data, action: lastAction })}\n\n`);
        }
      }

      // Track navigation events
      if (msg.method === 'Page.frameNavigated') {
        const url = msg.params?.frame?.url || '';
        lastAction = `Navigate: ${url}`;
        broadcastStatus();
      }
    });

    ws.on('error', (err) => {
      console.error('CDP WebSocket error:', err.message);
    });

    ws.on('close', () => {
      console.log('Chrome connection closed');
      process.exit(0);
    });
  });
}

function broadcastStatus() {
  for (const client of clients) {
    client.write(`event: status\ndata: ${JSON.stringify({ action: lastAction })}\n\n`);
  }
}

// Update last action from external source (CLI can POST to /action)
function handleActionUpdate(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      lastAction = data.action || '';
      broadcastStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400);
      res.end('{"error":"invalid json"}');
    }
  });
}

const HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Cheliped Monitor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: -apple-system, 'Segoe UI', sans-serif;
    color: #c9d1d9;
    height: 100vh;
    overflow: hidden;
  }
  .header {
    padding: 6px 12px;
    background: #161b22;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    border-bottom: 1px solid #30363d;
    flex-shrink: 0;
  }
  .logo {
    font-weight: 700;
    color: #f0883e;
    font-size: 13px;
    letter-spacing: 0.5px;
  }
  .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #f85149;
    flex-shrink: 0;
  }
  .dot.live {
    background: #3fb950;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .status { color: #8b949e; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: #484f58; font-size: 11px; font-variant-numeric: tabular-nums; }
  .viewer {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 4px;
    position: relative;
  }
  #screen {
    max-width: 100%;
    max-height: 100%;
    border-radius: 6px;
    border: 1px solid #30363d;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .waiting {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #484f58;
  }
  .waiting svg { animation: spin 2s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .action-bar {
    padding: 4px 12px;
    background: #161b22;
    width: 100%;
    border-top: 1px solid #30363d;
    font-size: 11px;
    color: #8b949e;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-bar .label { color: #f0883e; font-weight: 600; }
</style>
</head><body>
<div class="header">
  <span class="logo">CHELIPED</span>
  <div class="dot" id="dot"></div>
  <span class="status" id="status">Connecting...</span>
  <span class="meta" id="meta"></span>
</div>
<div class="viewer">
  <img id="screen" style="display:none" />
  <div class="waiting" id="waiting">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#484f58" stroke-width="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    <span>Waiting for frames...</span>
  </div>
</div>
<div class="action-bar" id="actionBar">
  <span class="label">IDLE</span>
</div>
<script>
const img = document.getElementById('screen');
const dot = document.getElementById('dot');
const status = document.getElementById('status');
const meta = document.getElementById('meta');
const waiting = document.getElementById('waiting');
const actionBar = document.getElementById('actionBar');

let frames = 0;
let lastSec = Date.now();
let connected = false;

const es = new EventSource('/stream');

es.onmessage = (e) => {
  try {
    const d = JSON.parse(e.data);
    img.src = 'data:image/jpeg;base64,' + d.frame;
    img.style.display = 'block';
    waiting.style.display = 'none';
    if (!connected) {
      connected = true;
      dot.classList.add('live');
      status.textContent = 'Live';
    }
    frames++;
    const now = Date.now();
    if (now - lastSec >= 1000) {
      meta.textContent = frames + ' fps';
      frames = 0;
      lastSec = now;
    }
    if (d.action) {
      actionBar.innerHTML = '<span class="label">ACTION</span> ' + escHtml(d.action);
    }
  } catch {}
};

es.addEventListener('status', (e) => {
  try {
    const d = JSON.parse(e.data);
    if (d.action) {
      actionBar.innerHTML = '<span class="label">ACTION</span> ' + escHtml(d.action);
    }
  } catch {}
});

es.onerror = () => {
  connected = false;
  dot.classList.remove('live');
  status.textContent = 'Reconnecting...';
  meta.textContent = '';
};

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
</script>
</body></html>`;

async function main() {
  let sessionName = 'default';
  let monitorPort = DEFAULT_MONITOR_PORT;
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session' && args[i + 1]) {
      sessionName = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      monitorPort = parseInt(args[++i], 10);
    }
  }

  const sessionFile = `${SESSION_FILE_PREFIX}${sessionName}.json`;
  const pidFile = `${MONITOR_PID_PREFIX}${sessionName}.pid`;

  if (!existsSync(sessionFile)) {
    console.error(JSON.stringify({ error: `세션 없음: ${sessionFile}. 먼저 cheliped-cli로 Chrome을 시작하세요.` }));
    process.exit(1);
  }

  const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  if (!session.port) {
    console.error(JSON.stringify({ error: 'CDP 포트 정보 없음' }));
    process.exit(1);
  }

  // Save monitor PID
  writeFileSync(pidFile, String(process.pid));
  process.on('exit', () => {
    try { unlinkSync(pidFile); } catch {}
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  console.log(`Connecting to Chrome on port ${session.port}...`);

  const browserWsUrl = await getBrowserWsUrl(session.port);
  const ws = await startScreencast(browserWsUrl);
  console.log('Screencast started');

  // HTTP server
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/action') {
      return handleActionUpdate(req, res);
    }

    if (req.url === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      clients.add(res);
      if (currentFrame) {
        res.write(`data: ${JSON.stringify({ frame: currentFrame, action: lastAction })}\n\n`);
      }
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, frames: frameCount, clients: clients.size }));
      return;
    }

    // Serve HTML
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });

  server.listen(monitorPort, () => {
    const url = `http://localhost:${monitorPort}`;
    console.log(`Monitor: ${url}`);

    // Open in default browser (macOS: small window)
    const platform = process.platform;
    if (platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to open location "${url}"'`);
    } else if (platform === 'linux') {
      exec(`xdg-open "${url}"`);
    } else if (platform === 'win32') {
      exec(`start "${url}"`);
    }
  });
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
