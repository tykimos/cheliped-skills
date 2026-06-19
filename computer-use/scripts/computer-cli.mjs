#!/usr/bin/env node
/**
 * computer-cli.mjs — drive macOS from the terminal.
 *
 * Mirrors the cheliped-browser CLI: pass a JSON array of commands, get JSON back.
 *
 *   node computer-cli.mjs '[{"cmd":"screenshot"},{"cmd":"screen-size"}]'
 *
 * Output is ALWAYS a JSON array, one envelope per command:
 *   { "cmd": "click", "ok": true,  "result": { ... } }
 *   { "cmd": "click", "ok": false, "error": { "code": "E_NO_PERMISSION", "message": "..." } }
 * Compact by default; pass --pretty for indented output.
 *
 * Flags (before the JSON arg):
 *   --pretty        indent JSON output
 *   --allow-shell   enable the run-shell / run-applescript escape hatches (off by default)
 *
 * Backends:
 *   - osascript     (built in) — keyboard, app control, AppleScript, dialogs
 *   - screencapture (built in) — screenshots
 *   - sips/pbcopy   (built in) — image probing, clipboard (IME-safe typing)
 *   - cliclick      (brew install cliclick) — mouse move/click/drag, pointer position
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const exec = promisify(execFile);

// Typed error so handlers can attach a stable machine-readable code.
class CmdError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function sh(file, args, opts = {}) {
  const { stdout } = await exec(file, args, { maxBuffer: 1 << 24, ...opts });
  return stdout.trim();
}

async function osa(script) {
  return sh("osascript", ["-e", script]);
}

// Write text to a command's stdin (used for pbcopy — avoids AppleScript escaping limits).
function pipeTo(file, args, input) {
  return new Promise((res, rej) => {
    const p = spawn(file, args);
    p.on("error", rej);
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`${file} exited ${code}`))
    );
    p.stdin.end(input);
  });
}

let _cliclick = null;
async function cliclick(args) {
  await requireAccessibility(); // mouse control silently no-ops without it
  if (_cliclick === null) {
    try {
      _cliclick = (await sh("which", ["cliclick"])) || "";
    } catch {
      _cliclick = "";
    }
  }
  if (!_cliclick) {
    throw new CmdError(
      "E_NO_CLICLICK",
      "cliclick is required for mouse control. Install it with: brew install cliclick"
    );
  }
  return sh("cliclick", args);
}

// AppleScript string escaping for embedding text in `keystroke "..."`.
function asStr(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

// --- permission preflight (PR-C1) -------------------------------------------
// Keyboard/mouse input via System Events silently no-ops when Accessibility is
// not granted. We probe once and hard-error instead of reporting a false success.
let _ax = null; // true | false | null(unknown)
async function accessibilityEnabled() {
  if (_ax !== null) return _ax;
  try {
    const r = await osa(
      'tell application "System Events" to return UI elements enabled'
    );
    const t = r.trim();
    _ax = t === "true" ? true : t === "false" ? false : null;
  } catch {
    _ax = null; // probe itself blocked/unknown — don't block the action
  }
  return _ax;
}
async function requireAccessibility() {
  if ((await accessibilityEnabled()) === false) {
    throw new CmdError(
      "E_NO_PERMISSION",
      "Accessibility permission not granted — keyboard/mouse input will silently fail. " +
        "Grant it in System Settings → Privacy & Security → Accessibility, then restart the terminal."
    );
  }
}

// --- display scale (PR-C2) --------------------------------------------------
let _scale = null;
let _points = null; // { width, height }
async function displayInfo() {
  if (_scale !== null && _points !== null) return { scale: _scale, points: _points };
  const info = await sh("system_profiler", ["SPDisplaysDataType"]).catch(() => "");
  const logical = info.match(/UI Looks like:\s*(\d+)\s*x\s*(\d+)/i);
  const native = info.match(/Resolution:\s*(\d+)\s*x\s*(\d+)/i);
  if (logical) {
    _points = { width: Number(logical[1]), height: Number(logical[2]) };
    _scale = native ? Number(native[1]) / Number(logical[1]) || 1 : 1;
  } else if (native) {
    // Only native pixels known — assume non-scaled (best effort); callers get scale.
    _points = { width: Number(native[1]), height: Number(native[2]) };
    _scale = 1;
  } else {
    _points = { width: null, height: null };
    _scale = 1;
  }
  return { scale: _scale, points: _points };
}

async function pixelDims(file) {
  const dims = await sh("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const w = dims.match(/pixelWidth:\s*(\d+)/);
  const h = dims.match(/pixelHeight:\s*(\d+)/);
  return { width: w ? Number(w[1]) : null, height: h ? Number(h[1]) : null };
}

// Near-uniform (blank/black) frame detection via a tiny BMP — zero dependencies.
async function frameVariance(pngPath) {
  const bmp = path.join(os.tmpdir(), `cu-blankchk-${process.pid}.bmp`);
  try {
    await sh("sips", ["-Z", "24", "-s", "format", "bmp", pngPath, "--out", bmp]);
    const buf = readFileSync(bmp);
    if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null; // not BMP
    const off = buf.readUInt32LE(10);
    let n = 0, sum = 0, sumsq = 0;
    for (let i = off; i < buf.length; i++) {
      const v = buf[i];
      sum += v;
      sumsq += v * v;
      n++;
    }
    if (!n) return null;
    const mean = sum / n;
    return sumsq / n - mean * mean;
  } catch {
    return null;
  }
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

// Ensure the named app is frontmost before typing into it (QW-7, opt-in via `target`).
async function ensureFront(target) {
  if (!target) return;
  const cur = await osa(
    'tell application "System Events" to get name of first process whose frontmost is true'
  ).catch(() => null);
  if (cur === target) return;
  await osa(`tell application "${asStr(target)}" to activate`);
  await new Promise((r) => setTimeout(r, 250));
  const cur2 = await osa(
    'tell application "System Events" to get name of first process whose frontmost is true'
  ).catch(() => null);
  if (cur2 !== target) {
    throw new CmdError(
      "E_WRONG_FOCUS",
      `expected "${target}" to be frontmost but "${cur2}" is`
    );
  }
}

let ALLOW_SHELL = false;

const handlers = {
  // --- screen / pointer ---
  async screenshot({ args = [], region, maxWidth }) {
    const out =
      args[0] || path.join(os.tmpdir(), `cheliped-screenshot-${process.pid}.png`);
    // -x = no sound. -R x,y,w,h crops a region (points).
    const capArgs = ["-x"];
    let cropOffset = null;
    if (Array.isArray(region) && region.length === 4) {
      capArgs.push("-R", region.join(","));
      cropOffset = { x: Number(region[0]), y: Number(region[1]) };
    }
    capArgs.push(out);
    await sh("screencapture", capArgs);
    if (maxWidth) await sh("sips", ["-Z", String(maxWidth), out]).catch(() => {});

    const { scale } = await displayInfo();
    const px = await pixelDims(out).catch(() => ({ width: null, height: null }));
    const result = {
      path: out,
      pixelWidth: px.width,
      pixelHeight: px.height,
      pointWidth: px.width != null ? Math.round(px.width / scale) : null,
      pointHeight: px.height != null ? Math.round(px.height / scale) : null,
      scale,
    };
    if (cropOffset) result.cropOffset = cropOffset; // add to coords to map back to screen
    const variance = await frameVariance(out);
    if (variance != null && variance < 2) {
      result.warning =
        "frame is near-uniform — Screen Recording permission may be missing (System Settings → Privacy & Security → Screen Recording).";
    }
    return result;
  },

  async "screen-size"() {
    const { points, scale } = await displayInfo();
    if (points.width != null) {
      return { width: points.width, height: points.height, unit: "point", scale };
    }
    // Fallback: derive pixel size from a screenshot, convert to points.
    const tmp = path.join(os.tmpdir(), `cheliped-size-${process.pid}.png`);
    await sh("screencapture", ["-x", tmp]);
    const px = await pixelDims(tmp);
    return {
      width: px.width != null ? Math.round(px.width / scale) : null,
      height: px.height != null ? Math.round(px.height / scale) : null,
      unit: "point",
      scale,
    };
  },

  async "mouse-pos"() {
    const r = await cliclick(["p:."]); // print current position (points)
    const [x, y] = r.replace(/[^0-9,]/g, "").split(",").map(Number);
    return { x, y, unit: "point" };
  },

  async move({ args }) {
    const [x, y] = args;
    await cliclick([`m:${x},${y}`]);
    return { x: Number(x), y: Number(y) };
  },

  async click({ args = [] }) {
    await cliclick([args.length >= 2 ? `c:${args[0]},${args[1]}` : "c:."]);
    return {};
  },

  async "double-click"({ args = [] }) {
    await cliclick([args.length >= 2 ? `dc:${args[0]},${args[1]}` : "dc:."]);
    return {};
  },

  async "right-click"({ args = [] }) {
    await cliclick([args.length >= 2 ? `rc:${args[0]},${args[1]}` : "rc:."]);
    return {};
  },

  async drag({ args }) {
    // [x1,y1,x2,y2] — press at start, drag to end.
    const [x1, y1, x2, y2] = args;
    await cliclick([`m:${x1},${y1}`, "dd:.", `m:${x2},${y2}`, "du:."]);
    return {};
  },

  async scroll({ args }) {
    // [amount] positive = up (pageup), negative = down (pagedown). |amount|/5 pages.
    await requireAccessibility();
    const amount = Number(args[0] ?? -5);
    const key = amount >= 0 ? 116 : 121; // pageup / pagedown
    const n = Math.max(1, Math.abs(Math.round(amount / 5)));
    // Single osascript spawn for all pages (QW-6).
    await osa(
      `tell application "System Events" to repeat ${n} times\nkey code ${key}\nend repeat`
    );
    return { pages: n };
  },

  // --- keyboard ---
  async type({ args, target, noClipboard }) {
    await requireAccessibility();
    await ensureFront(target);
    const text = String(args[0] ?? "");
    // IME-safe path: non-ASCII or multiline goes via clipboard paste, which
    // delivers correctly to CJK/IME fields where per-char keystroke drops or
    // mangles characters (PR-C3). ASCII single-line keeps the keystroke path.
    const needsClipboard = !noClipboard && /[^\x20-\x7e]|[\n\r\t]/.test(text);
    if (needsClipboard) {
      const prev = await sh("pbpaste", []).catch(() => null);
      await pipeTo("pbcopy", [], text);
      await osa(
        'tell application "System Events" to keystroke "v" using {command down}'
      );
      if (prev != null) {
        await new Promise((r) => setTimeout(r, 50));
        await pipeTo("pbcopy", [], prev).catch(() => {});
      }
      return { method: "paste" };
    }
    await osa(`tell application "System Events" to keystroke "${asStr(text)}"`);
    return { method: "keystroke" };
  },

  async paste({ args, target }) {
    await requireAccessibility();
    await ensureFront(target);
    if (args[0] !== undefined) await pipeTo("pbcopy", [], String(args[0]));
    await osa(
      'tell application "System Events" to keystroke "v" using {command down}'
    );
    return { method: "paste" };
  },

  async key({ args, target }) {
    // e.g. "cmd c", "cmd shift 4", "enter", "escape"
    await requireAccessibility();
    await ensureFront(target);
    const parts = String(args[0]).trim().split(/[\s+]+/);
    const mods = [];
    let key = null;
    for (const p of parts) {
      const lp = p.toLowerCase();
      if (MODIFIERS[lp]) mods.push(MODIFIERS[lp]);
      else key = p;
    }
    if (key == null) throw new CmdError("E_BAD_ARG", `no key in combo: ${args[0]}`);
    const using = mods.length
      ? ` using {${mods.map((m) => `${m} down`).join(", ")}}`
      : "";
    const code = KEY_CODES[key.toLowerCase()];
    const action =
      code != null
        ? `key code ${code}${using}`
        : `keystroke "${asStr(key)}"${using}`;
    await osa(`tell application "System Events" to ${action}`);
    return { combo: args[0] };
  },

  // --- applications ---
  async launch({ args }) {
    await sh("open", ["-a", args[0]]);
    return { app: args[0] };
  },

  async activate({ args }) {
    await osa(`tell application "${asStr(args[0])}" to activate`);
    return { app: args[0] };
  },

  async quit({ args }) {
    await osa(`tell application "${asStr(args[0])}" to quit`);
    return { app: args[0] };
  },

  async open({ args }) {
    // open a URL or file path with the default handler
    await sh("open", [args[0]]);
    return { target: args[0] };
  },

  async "list-apps"() {
    // Use a sentinel delimiter so app names containing commas survive (QW-8).
    const r = await osa(
      'set text item delimiters to "\\n"\n' +
        'tell application "System Events" to get name of (every process whose background only is false) as text'
    );
    return { apps: r.split("\n").map((s) => s.trim()).filter(Boolean) };
  },

  async frontmost() {
    const r = await osa(
      'tell application "System Events" to get name of first process whose frontmost is true'
    );
    return { app: r };
  },

  // --- escape hatches (gated behind --allow-shell, PR-C5) ---
  async "run-applescript"({ args }) {
    if (!ALLOW_SHELL)
      throw new CmdError(
        "E_DISABLED",
        "run-applescript is disabled. Re-run with --allow-shell to enable arbitrary AppleScript execution."
      );
    const result = await osa(args[0]);
    return { result, audited: true };
  },

  async "run-shell"({ args }) {
    if (!ALLOW_SHELL)
      throw new CmdError(
        "E_DISABLED",
        "run-shell is disabled. Re-run with --allow-shell to enable arbitrary shell execution."
      );
    const stdout = await sh("/bin/sh", ["-c", args[0]]);
    return { stdout, audited: true };
  },

  async notify({ args }) {
    const [text, title = "Claude"] = args;
    await osa(
      `display notification "${asStr(text)}" with title "${asStr(title)}"`
    );
    return {};
  },

  async wait({ args }) {
    await new Promise((r) => setTimeout(r, Number(args[0] ?? 1000)));
    return {};
  },
};

function classify(e) {
  if (e instanceof CmdError) return e.code;
  const m = e.message || "";
  if (/cliclick is required/i.test(m)) return "E_NO_CLICLICK";
  if (/timed out|ETIMEDOUT|timeout/i.test(m)) return "E_TIMEOUT";
  if (/ENOENT|not found/i.test(m)) return "E_NOT_FOUND";
  return "E_UNKNOWN";
}

async function main() {
  const argv = process.argv.slice(2);
  let pretty = false;
  let raw = null;
  for (const a of argv) {
    if (a === "--pretty") pretty = true;
    else if (a === "--allow-shell") ALLOW_SHELL = true;
    else if (raw === null) raw = a;
  }

  if (!raw) {
    console.error(
      'usage: node computer-cli.mjs [--pretty] [--allow-shell] \'[{"cmd":"screenshot"}]\''
    );
    process.exit(1);
  }

  let cmds;
  try {
    cmds = JSON.parse(raw);
    if (!Array.isArray(cmds)) cmds = [cmds];
  } catch (e) {
    console.log(
      JSON.stringify([{ cmd: null, ok: false, error: { code: "E_BAD_JSON", message: `invalid JSON: ${e.message}` } }])
    );
    process.exit(1);
  }

  const results = [];
  for (const c of cmds) {
    const h = handlers[c.cmd];
    if (!h) {
      results.push({
        cmd: c.cmd,
        ok: false,
        error: { code: "E_UNKNOWN_CMD", message: `unknown command: ${c.cmd}` },
      });
      continue; // per-command isolation (browser CLI matches this via --stop-on-error)
    }
    try {
      results.push({ cmd: c.cmd, ok: true, result: await h(c) });
    } catch (e) {
      results.push({
        cmd: c.cmd,
        ok: false,
        error: { code: classify(e), message: e.message },
      });
    }
  }
  console.log(JSON.stringify(results, null, pretty ? 2 : 0));
}

main();
