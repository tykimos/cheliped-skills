#!/usr/bin/env node
/**
 * computer-cli.mjs — drive macOS from the terminal.
 *
 * Mirrors the cheliped-browser CLI: pass a JSON array of commands, get JSON back.
 *
 *   node computer-cli.mjs '[{"cmd":"screenshot"},{"cmd":"screen-size"}]'
 *
 * Backends:
 *   - osascript     (built in) — keyboard, app control, AppleScript, dialogs
 *   - screencapture (built in) — screenshots
 *   - cliclick      (brew install cliclick) — mouse move/click/drag, pointer position
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);

async function sh(file, args, opts = {}) {
  const { stdout } = await exec(file, args, { maxBuffer: 1 << 24, ...opts });
  return stdout.trim();
}

async function osa(script) {
  return sh("osascript", ["-e", script]);
}

let _cliclick = null;
async function cliclick(args) {
  if (_cliclick === null) {
    try {
      _cliclick = (await sh("which", ["cliclick"])) || "";
    } catch {
      _cliclick = "";
    }
  }
  if (!_cliclick) {
    throw new Error(
      "cliclick is required for mouse control. Install it with: brew install cliclick"
    );
  }
  return sh("cliclick", args);
}

// AppleScript string escaping for embedding text in `keystroke "..."`.
function asStr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const KEY_CODES = {
  enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51,
  escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121, forwarddelete: 117,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
};
const MODIFIERS = {
  cmd: "command", command: "command", "⌘": "command",
  ctrl: "control", control: "control", "⌃": "control",
  alt: "option", opt: "option", option: "option", "⌥": "option",
  shift: "shift", "⇧": "shift",
};

const handlers = {
  // --- screen / pointer ---
  async "screenshot"({ args = [] }) {
    const out =
      args[0] ||
      path.join(os.tmpdir(), `cheliped-screenshot-${Date.now()}.png`);
    // -x = no sound. Captures the full screen silently.
    await sh("screencapture", ["-x", out]);
    return { success: true, path: out };
  },

  async "screen-size"() {
    // system_profiler needs no Automation permission. Prefer the logical
    // ("UI Looks like") resolution since click/move coordinates are in points.
    const info = await sh("system_profiler", ["SPDisplaysDataType"]).catch(() => "");
    const logical = info.match(/UI Looks like:\s*(\d+)\s*x\s*(\d+)/i);
    const native = info.match(/Resolution:\s*(\d+)\s*x\s*(\d+)/i);
    const m = logical || native;
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
    // Fallback: derive from a screenshot's pixel size via sips.
    const tmp = path.join(os.tmpdir(), `cheliped-size-${Date.now()}.png`);
    await sh("screencapture", ["-x", tmp]);
    const dims = await sh("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmp]);
    const w = dims.match(/pixelWidth:\s*(\d+)/);
    const h = dims.match(/pixelHeight:\s*(\d+)/);
    return { width: w ? Number(w[1]) : null, height: h ? Number(h[1]) : null };
  },

  async "mouse-pos"() {
    const r = await cliclick(["p:."]); // print current position
    const [x, y] = r.replace(/[^0-9,]/g, "").split(",").map(Number);
    return { x, y };
  },

  async "move"({ args }) {
    const [x, y] = args;
    await cliclick([`m:${x},${y}`]);
    return { success: true, x: Number(x), y: Number(y) };
  },

  async "click"({ args = [] }) {
    await cliclick([args.length >= 2 ? `c:${args[0]},${args[1]}` : "c:."]);
    return { success: true };
  },

  async "double-click"({ args = [] }) {
    await cliclick([args.length >= 2 ? `dc:${args[0]},${args[1]}` : "dc:."]);
    return { success: true };
  },

  async "right-click"({ args = [] }) {
    await cliclick([args.length >= 2 ? `rc:${args[0]},${args[1]}` : "rc:."]);
    return { success: true };
  },

  async "drag"({ args }) {
    // [x1,y1,x2,y2] — press at start, drag to end.
    const [x1, y1, x2, y2] = args;
    await cliclick([`m:${x1},${y1}`, "dd:.", `m:${x2},${y2}`, "du:."]);
    return { success: true };
  },

  async "scroll"({ args }) {
    // [amount] positive = up, negative = down (uses key-based paging fallback).
    const amount = Number(args[0] ?? -5);
    const key = amount >= 0 ? 116 : 121; // pageup / pagedown
    const n = Math.max(1, Math.abs(Math.round(amount / 5)));
    for (let i = 0; i < n; i++) await osa(`tell application "System Events" to key code ${key}`);
    return { success: true, pages: n };
  },

  // --- keyboard ---
  async "type"({ args }) {
    await osa(`tell application "System Events" to keystroke "${asStr(args[0])}"`);
    return { success: true };
  },

  async "key"({ args }) {
    // e.g. "cmd c", "cmd shift 4", "enter", "escape"
    const parts = String(args[0]).trim().split(/[\s+]+/);
    const mods = [];
    let target = null;
    for (const p of parts) {
      const lp = p.toLowerCase();
      if (MODIFIERS[lp]) mods.push(MODIFIERS[lp]);
      else target = p;
    }
    if (target == null) throw new Error(`no key in combo: ${args[0]}`);
    const using =
      mods.length ? ` using {${mods.map((m) => `${m} down`).join(", ")}}` : "";
    const code = KEY_CODES[target.toLowerCase()];
    const action =
      code != null
        ? `key code ${code}${using}`
        : `keystroke "${asStr(target)}"${using}`;
    await osa(`tell application "System Events" to ${action}`);
    return { success: true, combo: args[0] };
  },

  // --- applications ---
  async "launch"({ args }) {
    await sh("open", ["-a", args[0]]);
    return { success: true, app: args[0] };
  },

  async "activate"({ args }) {
    await osa(`tell application "${asStr(args[0])}" to activate`);
    return { success: true, app: args[0] };
  },

  async "quit"({ args }) {
    await osa(`tell application "${asStr(args[0])}" to quit`);
    return { success: true, app: args[0] };
  },

  async "open"({ args }) {
    // open a URL or file path with the default handler
    await sh("open", [args[0]]);
    return { success: true, target: args[0] };
  },

  async "list-apps"() {
    const r = await osa(
      'tell application "System Events" to get name of (every process whose background only is false)'
    );
    return { apps: r.split(",").map((s) => s.trim()).filter(Boolean) };
  },

  async "frontmost"() {
    const r = await osa(
      'tell application "System Events" to get name of first process whose frontmost is true'
    );
    return { app: r };
  },

  // --- escape hatches ---
  async "run-applescript"({ args }) {
    const result = await osa(args[0]);
    return { success: true, result };
  },

  async "run-shell"({ args }) {
    const stdout = await sh("/bin/sh", ["-c", args[0]]);
    return { success: true, stdout };
  },

  async "notify"({ args }) {
    const [text, title = "Claude"] = args;
    await osa(
      `display notification "${asStr(text)}" with title "${asStr(title)}"`
    );
    return { success: true };
  },

  async "wait"({ args }) {
    await new Promise((r) => setTimeout(r, Number(args[0] ?? 1000)));
    return { success: true };
  },
};

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("usage: node computer-cli.mjs '[{\"cmd\":\"screenshot\"}]'");
    process.exit(1);
  }
  let cmds;
  try {
    cmds = JSON.parse(raw);
    if (!Array.isArray(cmds)) cmds = [cmds];
  } catch (e) {
    console.log(JSON.stringify({ error: `invalid JSON: ${e.message}` }));
    process.exit(1);
  }

  const results = [];
  for (const c of cmds) {
    const h = handlers[c.cmd];
    if (!h) {
      results.push({ cmd: c.cmd, error: `unknown command: ${c.cmd}` });
      continue;
    }
    try {
      results.push({ cmd: c.cmd, ...(await h(c)) });
    } catch (e) {
      results.push({ cmd: c.cmd, error: e.message });
    }
  }
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

main();
