#!/usr/bin/env node
// cheliped-cli.mjs — OpenClaw/Claude Code 에이전트용 Cheliped 브라우저 CLI 래퍼
// 세션 유지: Chrome을 백그라운드에 살려두고 재연결
//
// 사용법: node cheliped-cli.mjs [--session <name>] '<JSON 명령 배열>'
// 예시: node cheliped-cli.mjs '[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]'
// 예시: node cheliped-cli.mjs --session agent1 '[{"cmd":"goto","args":["https://example.com"]}]'

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

// 세션 파일: Chrome PID + 포트 정보를 저장 (세션별로 동적으로 설정됨)
let SESSION_FILE = '/tmp/cheliped-session-default.json';
const DEFAULT_SCREENSHOT = '/tmp/cheliped-screenshot.png';

// Cheliped project root (CLI is at scripts/, root is ../)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHELIPED_PROJECT = __dirname;

async function loadCheliped() {
  try {
    const mod = await import('cheliped-browser');
    return mod.Cheliped;
  } catch {
    try {
      const distPath = resolve(CHELIPED_PROJECT, 'dist/index.js');
      const mod = await import(distPath);
      return mod.Cheliped;
    } catch {
      throw new Error(
        'cheliped-browser 패키지를 찾을 수 없습니다. ' +
        `${CHELIPED_PROJECT} 에서 'npm run build'를 실행하세요.`
      );
    }
  }
}

function loadSession() {
  if (existsSync(SESSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      // Chrome 프로세스가 살아있는지 확인
      if (data.pid) {
        try {
          process.kill(data.pid, 0); // 시그널 0 = 존재 확인만
          return data;
        } catch {
          // 프로세스가 죽었으면 세션 무효
          unlinkSync(SESSION_FILE);
          return null;
        }
      }
      return data;
    } catch {
      return null;
    }
  }
  return null;
}

function saveSession(info) {
  writeFileSync(SESSION_FILE, JSON.stringify(info, null, 2), 'utf8');
}

function clearSession() {
  if (existsSync(SESSION_FILE)) {
    unlinkSync(SESSION_FILE);
  }
}

// Chrome 프로세스 강제 종료
function killChrome(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // 이미 죽었을 수 있음
  }
}

async function getConnectedCheliped(Cheliped, session, headless = true) {
  const cheliped = new Cheliped({
    headless,
    stealth: true,
    compression: { enabled: true, maxTextLength: 200, maxTexts: 80, maxLinks: 50 },
  });

  if (session && session.port) {
    // 기존 Chrome에 재연결
    try {
      await cheliped.reconnect(session.port);
      return { cheliped, isNew: false };
    } catch {
      // 재연결 실패 → 새로 시작
      clearSession();
    }
  }

  // 새 Chrome 시작
  await cheliped.launch();
  const launchResult = cheliped.getLaunchResult();
  if (launchResult) {
    saveSession({
      port: launchResult.port,
      pid: launchResult.pid,
      wsUrl: launchResult.wsUrl,
      createdAt: new Date().toISOString(),
    });
  }
  return { cheliped, isNew: true };
}

async function executeCommand(cheliped, cmdObj) {
  const { cmd, args = [], params } = cmdObj;

  switch (cmd) {
    case 'launch':
      return { success: true, message: 'Chrome 실행 완료' };

    case 'goto': {
      const url = args[0];
      if (!url) throw new Error('goto: URL이 필요합니다.');
      const result = await cheliped.goto(url);
      return { success: true, url: result.url, title: result.title };
    }

    case 'observe':
      return await cheliped.observe();

    case 'observe-graph':
      return await cheliped.observeGraph();

    case 'actions':
      return await cheliped.actions();

    case 'click': {
      const agentId = parseInt(args[0], 10);
      if (isNaN(agentId)) throw new Error('click: 유효한 agentId(숫자)가 필요합니다.');
      return await cheliped.click(agentId);
    }

    case 'fill': {
      const agentId = parseInt(args[0], 10);
      const text = args[1];
      if (isNaN(agentId)) throw new Error('fill: 유효한 agentId(숫자)가 필요합니다.');
      if (text === undefined) throw new Error('fill: 입력할 텍스트가 필요합니다.');
      return await cheliped.fill(agentId, text);
    }

    case 'fill-human': {
      const agentId = parseInt(args[0], 10);
      const text = args[1];
      if (isNaN(agentId)) throw new Error('fill-human: 유효한 agentId(숫자)가 필요합니다.');
      if (text === undefined) throw new Error('fill-human: 입력할 텍스트가 필요합니다.');
      return await cheliped.fillHuman(agentId, text);
    }

    case 'select': {
      const agentId = parseInt(args[0], 10);
      const value = args[1];
      if (isNaN(agentId)) throw new Error('select: 유효한 agentId(숫자)가 필요합니다.');
      if (value === undefined) throw new Error('select: 선택할 값이 필요합니다.');
      return await cheliped.selectOption(agentId, value);
    }

    case 'fill-selector': {
      const selector = args[0];
      const text = args[1];
      if (!selector) throw new Error('fill-selector: CSS 선택자가 필요합니다. (예: "#inputId", ".w2input")');
      if (text === undefined) throw new Error('fill-selector: 입력할 텍스트가 필요합니다.');
      return await cheliped.fillBySelector(selector, text);
    }

    case 'click-selector': {
      const selector = args[0];
      if (!selector) throw new Error('click-selector: CSS 선택자가 필요합니다.');
      return await cheliped.clickBySelector(selector);
    }

    case 'focus-selector': {
      const selector = args[0];
      if (!selector) throw new Error('focus-selector: CSS 선택자가 필요합니다.');
      return await cheliped.focusBySelector(selector);
    }

    case 'type': {
      const text = args[0];
      if (text === undefined) throw new Error('type: 입력할 텍스트가 필요합니다.');
      return await cheliped.type(text);
    }

    case 'press-key': {
      const key = args[0];
      if (!key) throw new Error('press-key: 키 이름이 필요합니다. (예: "Enter", "Tab", "Backspace")');
      return await cheliped.pressKey(key);
    }

    case 'back':
      return await cheliped.goBack();

    case 'forward':
      return await cheliped.goForward();

    case 'hover': {
      const agentId = parseInt(args[0], 10);
      if (isNaN(agentId)) throw new Error('hover: 유효한 agentId(숫자)가 필요합니다.');
      return await cheliped.hover(agentId);
    }

    case 'scroll': {
      const direction = args[0] || 'down';
      const pixels = args[1] ? parseInt(args[1], 10) : undefined;
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        throw new Error(`scroll: 방향은 up, down, left, right 중 하나. 받은 값: ${direction}`);
      }
      return await cheliped.scroll(direction, pixels);
    }

    case 'wait-for': {
      const selector = args[0];
      const timeout = args[1] ? parseInt(args[1], 10) : undefined;
      if (!selector) throw new Error('wait-for: CSS 선택자가 필요합니다.');
      return await cheliped.waitForSelector(selector, timeout);
    }

    case 'wait': {
      const ms = parseInt(args[0] || '1000', 10);
      await new Promise(resolve => setTimeout(resolve, ms));
      return { success: true, action: 'wait', ms };
    }

    case 'perform': {
      const actionId = args[0];
      if (!actionId) throw new Error('perform: actionId가 필요합니다.');
      return await cheliped.perform(actionId, params || undefined);
    }

    case 'screenshot': {
      const filePath = args[0] || DEFAULT_SCREENSHOT;
      const result = await cheliped.screenshot();
      await writeFile(filePath, result.buffer);
      return { success: true, path: filePath, size: result.buffer.length };
    }

    case 'run-js': {
      const script = args[0];
      if (!script) throw new Error('run-js: JavaScript 코드가 필요합니다.');
      const result = await cheliped.runJs(script);
      return { success: true, result };
    }

    case 'search': {
      const query = args[0];
      const engine = args[1] || 'google';
      if (!query) throw new Error('search: 검색어가 필요합니다.');
      const validEngines = ['google', 'naver', 'bing', 'duckduckgo', 'baidu', 'yandex', 'yahoo_japan', 'ecosia'];
      if (!validEngines.includes(engine)) {
        throw new Error(`search: 엔진은 ${validEngines.join(', ')} 중 하나. 받은 값: ${engine}`);
      }
      return await cheliped.search(query, engine);
    }

    case 'extract': {
      const type = args[0] || 'all';
      if (!['text', 'links', 'all'].includes(type)) {
        throw new Error(`extract: 타입은 'text', 'links', 'all' 중 하나. 받은 값: ${type}`);
      }
      return await cheliped.extract(type);
    }

    case 'setup-downloads': {
      const downloadPath = args[0] || '/tmp/cheliped-downloads';
      await cheliped.setupDownloads(downloadPath);
      return { success: true, downloadPath };
    }

    case 'download': {
      const url = args[0];
      const downloadPath = args[1] || '/tmp/cheliped-downloads';
      if (!url) throw new Error('download: URL이 필요합니다.');
      const result = await cheliped.download(url, downloadPath);
      return result;
    }

    case 'download-click': {
      const agentId = parseInt(args[0], 10);
      const downloadPath = args[1] || '/tmp/cheliped-downloads';
      const timeout = parseInt(args[2] || '60000', 10);
      if (isNaN(agentId)) throw new Error('download-click: 유효한 agentId(숫자)가 필요합니다.');
      const result = await cheliped.downloadByClick(agentId, downloadPath, timeout);
      return result;
    }

    case 'download-js': {
      const jsExpr = args[0];
      const downloadPath = args[1] || '/tmp/cheliped-downloads';
      const timeout = parseInt(args[2] || '60000', 10);
      if (!jsExpr) throw new Error('download-js: JavaScript 코드가 필요합니다.');
      const result = await cheliped.downloadByJs(jsExpr, downloadPath, timeout);
      return result;
    }

    case 'monitor': {
      const monitorPort = args[0] || '19222';
      const pidFile = `/tmp/cheliped-monitor-${SESSION_FILE.split('-').pop().replace('.json', '')}.pid`;

      // Check if already running
      if (existsSync(pidFile)) {
        try {
          const pid = parseInt(readFileSync(pidFile, 'utf8'), 10);
          process.kill(pid, 0);
          return { success: true, message: '모니터 이미 실행 중', url: `http://localhost:${monitorPort}`, pid };
        } catch {
          // dead process, clean up
        }
      }

      // Spawn monitor as background process
      const monitorScript = resolve(CHELIPED_PROJECT, 'cheliped-monitor.mjs');
      const sessionFlag = SESSION_FILE.split('-').pop().replace('.json', '');
      const child = spawn('node', [monitorScript, '--session', sessionFlag, '--port', monitorPort], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      // Wait briefly for monitor to start
      await new Promise(r => setTimeout(r, 1500));
      return { success: true, url: `http://localhost:${monitorPort}`, pid: child.pid };
    }

    case 'monitor-stop': {
      const pidFile = `/tmp/cheliped-monitor-${SESSION_FILE.split('-').pop().replace('.json', '')}.pid`;
      if (existsSync(pidFile)) {
        try {
          const pid = parseInt(readFileSync(pidFile, 'utf8'), 10);
          process.kill(pid, 'SIGTERM');
          return { success: true, message: '모니터 종료됨' };
        } catch {
          return { success: true, message: '모니터 이미 종료됨' };
        }
      }
      return { success: true, message: '실행 중인 모니터 없음' };
    }

    case 'monitor-action': {
      // Notify the monitor about current action (for action bar display)
      const monitorPort = args[1] || '19222';
      const action = args[0] || '';
      try {
        await fetch(`http://localhost:${monitorPort}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
      } catch { /* monitor not running */ }
      return { success: true };
    }

    case 'observe-shadow': {
      const result = await cheliped.observeShadow();
      return result;
    }

    case 'click-deep': {
      const selector = args[0];
      if (!selector) throw new Error('click-deep: CSS 선택자가 필요합니다. shadow DOM 관통: "#host >>> inner-selector"');
      return await cheliped.clickDeep(selector);
    }

    case 'fill-deep': {
      const selector = args[0];
      const text = args[1];
      if (!selector) throw new Error('fill-deep: CSS 선택자가 필요합니다.');
      if (text === undefined) throw new Error('fill-deep: 입력할 텍스트가 필요합니다.');
      return await cheliped.fillDeep(selector, text);
    }

    case 'list-frames': {
      const frames = await cheliped.listFrames();
      return { success: true, frames };
    }

    case 'observe-frame': {
      const target = args[0];
      if (target === undefined) throw new Error('observe-frame: 프레임 인덱스(숫자) 또는 URL 부분 문자열이 필요합니다.');
      const result = await cheliped.observeFrame(target);
      return result;
    }

    case 'click-frame': {
      const target = args[0];
      const selector = args[1];
      if (target === undefined) throw new Error('click-frame: 프레임 인덱스(숫자) 또는 URL 부분 문자열이 필요합니다.');
      if (!selector) throw new Error('click-frame: iframe 내부의 CSS 선택자가 필요합니다.');
      return await cheliped.clickInFrame(target, selector);
    }

    case 'fill-frame': {
      const target = args[0];
      const selector = args[1];
      const text = args[2];
      if (target === undefined) throw new Error('fill-frame: 프레임 인덱스(숫자) 또는 URL 부분 문자열이 필요합니다.');
      if (!selector) throw new Error('fill-frame: iframe 내부의 CSS 선택자가 필요합니다.');
      if (text === undefined) throw new Error('fill-frame: 입력할 텍스트가 필요합니다.');
      return await cheliped.fillInFrame(target, selector, text);
    }

    case 'run-js-frame': {
      const target = args[0];
      const script = args[1];
      if (target === undefined) throw new Error('run-js-frame: 프레임 인덱스(숫자) 또는 URL 부분 문자열이 필요합니다.');
      if (!script) throw new Error('run-js-frame: JavaScript 코드가 필요합니다.');
      const result = await cheliped.runJsInFrame(target, script);
      return { success: true, result };
    }

    case 'close': {
      // Stop monitor if running
      const monPidFile = `/tmp/cheliped-monitor-${SESSION_FILE.split('-').pop().replace('.json', '')}.pid`;
      if (existsSync(monPidFile)) {
        try {
          const pid = parseInt(readFileSync(monPidFile, 'utf8'), 10);
          process.kill(pid, 'SIGTERM');
        } catch {}
      }

      const session = loadSession();
      await cheliped.close();
      if (session?.pid) killChrome(session.pid);
      clearSession();
      return { success: true, message: 'Chrome 종료 완료' };
    }

    default:
      throw new Error(`알 수 없는 명령: ${cmd}`);
  }
}

async function main() {
  let sessionName = 'default';
  let headless = true;

  // Parse CLI flags from argv (before the JSON command argument)
  const flagArgs = process.argv.slice(2);
  let jsonArgIndex = -1;

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === '--session' && i + 1 < flagArgs.length) {
      sessionName = flagArgs[i + 1];
      i++; // skip next
    } else if (arg.startsWith('--session=')) {
      sessionName = arg.split('=')[1];
    } else if (arg === '--no-headless' || arg === '--headed') {
      headless = false;
    } else if (arg === '--headless') {
      headless = true;
    } else {
      // First non-flag argument is the JSON command
      jsonArgIndex = i;
      break;
    }
  }

  let rawArg = jsonArgIndex >= 0 ? flagArgs[jsonArgIndex] : undefined;

  SESSION_FILE = `/tmp/cheliped-session-${sessionName}.json`;

  if (!rawArg) {
    console.error(JSON.stringify({
      error: '명령 인수가 필요합니다.',
      usage: 'node cheliped-cli.mjs [--session <name>] [--no-headless] \'[{"cmd":"goto","args":["https://example.com"]},{"cmd":"observe"}]\'',
    }));
    process.exit(1);
  }

  let commands;
  try {
    commands = JSON.parse(rawArg);
    if (!Array.isArray(commands)) commands = [commands];
  } catch (e) {
    console.error(JSON.stringify({ error: `JSON 파싱 오류: ${e.message}` }));
    process.exit(1);
  }

  let Cheliped;
  try {
    Cheliped = await loadCheliped();
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }

  // close만 있고 세션 없으면 바로 종료
  if (commands.length === 1 && commands[0].cmd === 'close') {
    const session = loadSession();
    if (!session) {
      console.log(JSON.stringify([{ cmd: 'close', result: { success: true, message: '세션 없음' } }]));
      return;
    }
    // 세션이 있으면 Chrome kill
    killChrome(session.pid);
    clearSession();
    console.log(JSON.stringify([{ cmd: 'close', result: { success: true, message: 'Chrome 종료 완료' } }]));
    return;
  }

  const session = loadSession();
  let cheliped;
  let results = [];
  let closeRequested = false;

  try {
    const connected = await getConnectedCheliped(Cheliped, session, headless);
    cheliped = connected.cheliped;

    for (const cmdObj of commands) {
      try {
        const result = await executeCommand(cheliped, cmdObj);
        results.push({ cmd: cmdObj.cmd, result });
        if (cmdObj.cmd === 'close') {
          closeRequested = true;
          break;
        }
      } catch (e) {
        results.push({ cmd: cmdObj.cmd, error: e.message });
        break;
      }
    }

    // close가 아니면 WebSocket만 끊고 Chrome은 살려둠
    if (!closeRequested) {
      await cheliped.detach();
    }
  } catch (e) {
    clearSession();
    console.error(JSON.stringify({
      error: `브라우저 연결 실패: ${e.message}`,
      hint: '세션 초기화됨. 재실행해 주세요.',
    }));
    process.exit(1);
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: `예기치 않은 오류: ${err.message}` }));
  process.exit(1);
});
