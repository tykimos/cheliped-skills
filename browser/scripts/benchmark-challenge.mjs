#!/usr/bin/env node
// benchmark-challenge.mjs — Test on complex, challenging real-world websites
// Targets: e-commerce, news portals, dashboards, heavy SPAs, complex forms, i18n

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.ceil(str.length / 4);
}

// ─── Challenging Test Sites ──────────────────────────────────────

const CHALLENGES = [
  // E-commerce (tons of product cards, filters, dropdowns)
  { name: 'Amazon', url: 'https://www.amazon.com/s?k=laptop', category: 'E-commerce' },
  { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=laptop', category: 'E-commerce' },

  // News portals (media-heavy, ads, complex layouts)
  { name: 'CNN', url: 'https://edition.cnn.com', category: 'News Portal' },
  { name: 'BBC', url: 'https://www.bbc.com/news', category: 'News Portal' },

  // Complex web apps / dashboards
  { name: 'GitHub Issues', url: 'https://github.com/microsoft/vscode/issues', category: 'Web App' },
  { name: 'GitLab Explore', url: 'https://gitlab.com/explore/projects/trending', category: 'Web App' },

  // Deeply nested / data-heavy pages
  { name: 'Hacker News Deep', url: 'https://news.ycombinator.com/item?id=41778461', category: 'Deep Nesting' },
  { name: 'Wikipedia Long', url: 'https://en.wikipedia.org/wiki/List_of_programming_languages', category: 'Deep Nesting' },

  // Complex forms / multi-step
  { name: 'Booking.com', url: 'https://www.booking.com', category: 'Complex Form' },
  { name: 'Zillow', url: 'https://www.zillow.com', category: 'Complex Form' },

  // International / non-Latin scripts
  { name: 'Naver', url: 'https://www.naver.com', category: 'International' },
  { name: 'Baidu', url: 'https://www.baidu.com', category: 'International' },

  // Developer tools / documentation
  { name: 'Rust Docs', url: 'https://doc.rust-lang.org/std/index.html', category: 'Documentation' },
  { name: 'React Docs', url: 'https://react.dev/reference/react', category: 'Documentation' },
];

// ─── Cheliped ────────────────────────────────────────────────────

async function testCheliped(targets) {
  let Cheliped;
  try {
    const mod = await import('cheliped-browser');
    Cheliped = mod.Cheliped;
  } catch {
    const distPath = resolve(__dirname, 'dist/index.js');
    const mod = await import(distPath);
    Cheliped = mod.Cheliped;
  }

  const cheliped = new Cheliped({
    headless: true,
    compression: { enabled: true, maxTextLength: 200, maxLinks: 500 },
  });
  await cheliped.launch();

  const results = [];

  for (const target of targets) {
    const r = { name: target.name, category: target.category, tool: 'Cheliped' };
    try {
      const navStart = performance.now();
      await cheliped.goto(target.url);
      r.navTime = Math.round(performance.now() - navStart);

      const obsStart = performance.now();
      const dom = await cheliped.observe();
      r.observeTime = Math.round(performance.now() - obsStart);

      const domStr = JSON.stringify(dom);
      r.tokens = estimateTokens(domStr);
      r.links = (dom.links || []).length;
      r.buttons = (dom.buttons || []).length;
      r.inputs = (dom.inputs || []).length;
      r.texts = (dom.texts || []).length;
      r.headings = [...(dom.texts || []), ...(dom.links || []), ...(dom.buttons || [])].filter(t => /^h[1-6]$/.test(t.tag)).length;
      r.images = (dom.images || []).length;
      r.selects = (dom.selects || []).length;
      r.textareas = (dom.textareas || []).length;
      r.totalInteractive = r.links + r.buttons + r.inputs + r.selects + r.textareas;

      // Also test fast extract paths
      const extractTextStart = performance.now();
      const textResult = await cheliped.extract('text');
      r.extractTextTime = Math.round(performance.now() - extractTextStart);
      r.extractTextCount = Array.isArray(textResult.data) ? textResult.data.length : 0;

      const extractLinksStart = performance.now();
      const linksResult = await cheliped.extract('links');
      r.extractLinksTime = Math.round(performance.now() - extractLinksStart);
      r.extractLinksCount = Array.isArray(linksResult.data) ? linksResult.data.length : 0;

      r.success = true;
    } catch (e) {
      r.success = false;
      r.error = e.message?.substring(0, 120);
    }
    results.push(r);
  }

  await cheliped.close();
  return results;
}

// ─── Playwright ──────────────────────────────────────────────────

async function testPlaywright(targets) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return [];
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  for (const target of targets) {
    const r = { name: target.name, category: target.category, tool: 'Playwright' };
    try {
      const navStart = performance.now();
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      r.navTime = Math.round(performance.now() - navStart);

      const obsStart = performance.now();
      const snapshot = await page.locator('body').ariaSnapshot({ timeout: 15000 });
      r.observeTime = Math.round(performance.now() - obsStart);

      r.tokens = estimateTokens(snapshot);

      const lines = snapshot.split('\n');
      r.links = lines.filter(l => /^\s*- link\b/.test(l)).length;
      r.buttons = lines.filter(l => /^\s*- button\b/.test(l)).length;
      r.inputs = lines.filter(l => /^\s*- (textbox|searchbox|combobox|spinbutton)\b/.test(l)).length;
      r.headings = lines.filter(l => /^\s*- heading\b/.test(l)).length;
      r.texts = lines.filter(l => /^\s*- (paragraph|text|listitem)\b/.test(l)).length;
      r.images = lines.filter(l => /^\s*- img\b/.test(l)).length;
      r.totalInteractive = r.links + r.buttons + r.inputs;

      r.success = true;
    } catch (e) {
      r.success = false;
      r.error = e.message?.substring(0, 120);
    }
    results.push(r);
  }

  await browser.close();
  return results;
}

// ─── Puppeteer ───────────────────────────────────────────────────

async function testPuppeteer(targets) {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    return [];
  }

  const browser = await puppeteer.default.launch({ headless: 'new' });
  const page = await browser.newPage();
  const results = [];

  for (const target of targets) {
    const r = { name: target.name, category: target.category, tool: 'Puppeteer' };
    try {
      const navStart = performance.now();
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      r.navTime = Math.round(performance.now() - navStart);

      const obsStart = performance.now();
      const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
      r.observeTime = Math.round(performance.now() - obsStart);

      const snapshotStr = JSON.stringify(snapshot);
      r.tokens = estimateTokens(snapshotStr);

      let links = 0, buttons = 0, inputs = 0, headings = 0, texts = 0, images = 0;
      function walk(node) {
        if (!node) return;
        if (node.role === 'link') links++;
        if (node.role === 'button') buttons++;
        if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(node.role)) inputs++;
        if (node.role === 'heading') headings++;
        if (['StaticText', 'paragraph'].includes(node.role)) texts++;
        if (node.role === 'img') images++;
        if (node.children) node.children.forEach(walk);
      }
      walk(snapshot);

      r.links = links;
      r.buttons = buttons;
      r.inputs = inputs;
      r.headings = headings;
      r.texts = texts;
      r.images = images;
      r.totalInteractive = links + buttons + inputs;

      r.success = true;
    } catch (e) {
      r.success = false;
      r.error = e.message?.substring(0, 120);
    }
    results.push(r);
  }

  await browser.close();
  return results;
}

// ─── Tandem Browser (AXTree via CDP) ─────────────────────────────
// Replicates Tandem Browser's snapshot approach:
// Uses Accessibility.getFullAXTree() via CDP, builds tree, assigns @refs,
// formats as indented text: "- role "name" [@ref] attrs"

const TANDEM_INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio',
  'combobox', 'menuitem', 'tab', 'searchbox',
]);

function tandemBuildTree(rawNodes) {
  if (rawNodes.length === 0) return [];
  const nodeMap = new Map();
  for (const raw of rawNodes) nodeMap.set(raw.nodeId, raw);

  function convert(raw) {
    const role = raw.role?.value || 'none';
    const name = raw.name?.value || '';
    const value = raw.value?.value || '';
    const children = [];
    if (raw.childIds) {
      for (const childId of raw.childIds) {
        const child = nodeMap.get(childId);
        if (child) children.push(convert(child));
      }
    }
    return { role, name: name || undefined, value: value || undefined, children };
  }

  return [convert(rawNodes[0])];
}

function tandemFilterCompact(nodes) {
  const result = [];
  for (const node of nodes) {
    const filteredChildren = tandemFilterCompact(node.children);
    const hasName = !!node.name;
    const isInteractive = TANDEM_INTERACTIVE_ROLES.has(node.role);
    const hasValue = !!node.value;
    const hasMeaningfulChildren = filteredChildren.length > 0;
    if (hasName || isInteractive || hasValue || hasMeaningfulChildren) {
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}

function tandemAssignRefs(nodes, state = { counter: 0 }) {
  for (const node of nodes) {
    if (node.name || TANDEM_INTERACTIVE_ROLES.has(node.role)) {
      state.counter++;
      node.ref = `@e${state.counter}`;
    }
    tandemAssignRefs(node.children, state);
  }
  return state.counter;
}

function tandemFormatTree(nodes, indent = 0) {
  const lines = [];
  const prefix = '  '.repeat(indent);
  for (const node of nodes) {
    let line = `${prefix}- ${node.role}`;
    if (node.name) line += ` "${node.name}"`;
    if (node.ref) line += ` [${node.ref}]`;
    if (node.value) line += ` value="${node.value}"`;
    lines.push(line);
    if (node.children.length > 0) {
      lines.push(tandemFormatTree(node.children, indent + 1));
    }
  }
  return lines.join('\n');
}

function tandemCountNodes(nodes) {
  let count = 0;
  for (const node of nodes) {
    count++;
    count += tandemCountNodes(node.children);
  }
  return count;
}

function tandemCountByRole(nodes, roles) {
  let count = 0;
  for (const node of nodes) {
    if (roles.includes(node.role)) count++;
    count += tandemCountByRole(node.children, roles);
  }
  return count;
}

async function testTandem(targets) {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    return [];
  }

  const browser = await puppeteer.default.launch({ headless: 'new' });
  const page = await browser.newPage();
  const results = [];

  const client = await page.createCDPSession();

  for (const target of targets) {
    const r = { name: target.name, category: target.category, tool: 'Tandem' };
    try {
      const navStart = performance.now();
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      r.navTime = Math.round(performance.now() - navStart);

      const obsStart = performance.now();
      await client.send('Accessibility.enable');
      const axResult = await client.send('Accessibility.getFullAXTree');
      const rawNodes = axResult.nodes || [];

      let tree = tandemBuildTree(rawNodes);
      tree = tandemFilterCompact(tree);
      tandemAssignRefs(tree);
      const text = tandemFormatTree(tree);
      r.observeTime = Math.round(performance.now() - obsStart);

      r.tokens = estimateTokens(text);
      r.links = tandemCountByRole(tree, ['link']);
      r.buttons = tandemCountByRole(tree, ['button']);
      r.inputs = tandemCountByRole(tree, ['textbox', 'searchbox', 'combobox', 'checkbox', 'radio']);
      r.headings = tandemCountByRole(tree, ['heading']);
      r.totalInteractive = r.links + r.buttons + r.inputs;

      r.success = true;
    } catch (e) {
      r.success = false;
      r.error = e.message?.substring(0, 120);
    }
    results.push(r);
  }

  await browser.close();
  return results;
}

// ─── Ground Truth ────────────────────────────────────────────────

async function collectGroundTruth(targets) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return [];
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  for (const target of targets) {
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const truth = await page.evaluate(() => {
        const count = (sel) => {
          let n = 0;
          document.querySelectorAll(sel).forEach(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') n++;
          });
          return n;
        };

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => {
            const el = n.parentElement;
            if (!el) return NodeFilter.FILTER_REJECT;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(el.tagName)) return NodeFilter.FILTER_REJECT;
            return n.textContent.trim().length >= 3 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        let textCount = 0;
        while (walker.nextNode()) textCount++;

        return {
          texts: textCount,
          links: count('a[href]'),
          buttons: count('button, [role="button"], input[type="submit"], input[type="button"]'),
          inputs: count('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'),
          headings: count('h1, h2, h3, h4, h5, h6'),
          images: count('img[src]'),
          totalDomNodes: document.querySelectorAll('*').length,
        };
      });

      results.push({ name: target.name, category: target.category, ...truth });
    } catch (e) {
      results.push({ name: target.name, category: target.category, error: e.message?.substring(0, 80) });
    }
  }

  await browser.close();
  return results;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('🦀 Cheliped Browser — Challenge Benchmark');
  console.log('═'.repeat(72));
  console.log('');
  console.log('Testing on complex, real-world websites');
  console.log(`Sites (${CHALLENGES.length}): ${CHALLENGES.map(t => t.name).join(', ')}`);
  console.log('');

  console.log('  📏 Ground truth...');
  const groundTruth = await collectGroundTruth(CHALLENGES);

  console.log('  🦀 Cheliped...');
  const chelipedRes = await testCheliped(CHALLENGES);

  console.log('  🎭 Playwright...');
  let playwrightRes = [];
  try {
    playwrightRes = await testPlaywright(CHALLENGES);
  } catch (e) {
    console.log(`  ⚠️ Playwright failed: ${e.message?.substring(0, 80)}`);
  }

  console.log('  🤖 Puppeteer...');
  let puppeteerRes = [];
  try {
    puppeteerRes = await testPuppeteer(CHALLENGES);
  } catch (e) {
    console.log(`  ⚠️ Puppeteer failed: ${e.message?.substring(0, 80)}`);
  }

  console.log('  🔗 Tandem Browser (AXTree via CDP)...');
  let tandemRes = [];
  try {
    tandemRes = await testTandem(CHALLENGES);
  } catch (e) {
    console.log(`  ⚠️ Tandem failed: ${e.message?.substring(0, 80)}`);
  }

  // ─── Output ────────────────────────────────────────────────────

  console.log('');
  console.log('═'.repeat(72));
  console.log('📊 CHALLENGE BENCHMARK RESULTS');
  console.log('═'.repeat(72));

  // Ground truth
  console.log('');
  console.log('## Ground Truth');
  console.log('');
  console.log('| Site | Category | DOM Nodes | Texts | Links | Buttons | Inputs | Headings |');
  console.log('|------|----------|----------:|------:|------:|--------:|-------:|---------:|');
  for (const gt of groundTruth) {
    if (gt.error) {
      console.log(`| ${gt.name} | ${gt.category} | ❌ | — | — | — | — | — |`);
    } else {
      console.log(`| ${gt.name} | ${gt.category} | ${gt.totalDomNodes.toLocaleString()} | ${gt.texts} | ${gt.links} | ${gt.buttons} | ${gt.inputs} | ${gt.headings} |`);
    }
  }

  // Token + Speed comparison
  console.log('');
  console.log('## Token Output & Speed');
  console.log('');
  console.log('| Site | Category | Cheliped Tok | CH Speed | PW Tok | PW Speed | PP Tok | PP Speed | TD Tok | TD Speed |');
  console.log('|------|----------|------------:|--------:|-------:|--------:|-------:|--------:|-------:|--------:|');
  for (const ch of CHALLENGES) {
    const cr = chelipedRes.find(r => r.name === ch.name);
    const pr = playwrightRes.find(r => r.name === ch.name);
    const pp = puppeteerRes.find(r => r.name === ch.name);
    const td = tandemRes.find(r => r.name === ch.name);
    const tok = r => r?.success ? r.tokens.toLocaleString() : '❌';
    const spd = r => r?.success ? `${r.observeTime}ms` : '❌';
    console.log(`| ${ch.name} | ${ch.category} | ${tok(cr)} | ${spd(cr)} | ${tok(pr)} | ${spd(pr)} | ${tok(pp)} | ${spd(pp)} | ${tok(td)} | ${spd(td)} |`);
  }

  // Element detection
  console.log('');
  console.log('## Element Detection (vs Ground Truth)');
  console.log('');
  console.log('| Site | GT Links | CH Links | PW Links | PP Links | TD Links | GT Btns | CH Btns | PW Btns | PP Btns | TD Btns | GT Inputs | CH Inputs | PW Inputs | PP Inputs | TD Inputs | GT Hdgs | CH Hdgs | PW Hdgs | PP Hdgs | TD Hdgs |');
  console.log('|------|--------:|--------:|--------:|--------:|--------:|--------:|--------:|--------:|--------:|--------:|----------:|----------:|----------:|----------:|----------:|--------:|--------:|--------:|--------:|--------:|');
  for (const ch of CHALLENGES) {
    const gt = groundTruth.find(g => g.name === ch.name);
    const cr = chelipedRes.find(r => r.name === ch.name);
    const pr = playwrightRes.find(r => r.name === ch.name);
    const pp = puppeteerRes.find(r => r.name === ch.name);
    const td = tandemRes.find(r => r.name === ch.name);
    const v = (r, key) => r?.success ? r[key] : '❌';
    const gtv = (key) => (!gt || gt.error) ? '—' : gt[key];
    console.log(`| ${ch.name} | ${gtv('links')} | ${v(cr,'links')} | ${v(pr,'links')} | ${v(pp,'links')} | ${v(td,'links')} | ${gtv('buttons')} | ${v(cr,'buttons')} | ${v(pr,'buttons')} | ${v(pp,'buttons')} | ${v(td,'buttons')} | ${gtv('inputs')} | ${v(cr,'inputs')} | ${v(pr,'inputs')} | ${v(pp,'inputs')} | ${v(td,'inputs')} | ${gtv('headings')} | ${v(cr,'headings')} | ${v(pr,'headings')} | ${v(pp,'headings')} | ${v(td,'headings')} |`);
  }

  // Fast extract() performance
  console.log('');
  console.log('## Fast Extract Performance (Cheliped only)');
  console.log('');
  console.log('| Site | observe() | extract(text) | extract(links) | Text Items | Link Items |');
  console.log('|------|----------:|--------------:|---------------:|-----------:|-----------:|');
  for (const cr of chelipedRes) {
    if (!cr.success) {
      console.log(`| ${cr.name} | ❌ | — | — | — | — |`);
      continue;
    }
    console.log(`| ${cr.name} | ${cr.observeTime}ms | ${cr.extractTextTime}ms | ${cr.extractLinksTime}ms | ${cr.extractTextCount} | ${cr.extractLinksCount} |`);
  }

  // ─── Per-category analysis ─────────────────────────────────────

  console.log('');
  console.log('═'.repeat(72));
  console.log('📈 PER-CATEGORY ANALYSIS');
  console.log('═'.repeat(72));

  const categories = [...new Set(CHALLENGES.map(e => e.category))];
  for (const cat of categories) {
    console.log('');
    console.log(`### ${cat}`);
    console.log('');

    const sites = CHALLENGES.filter(e => e.category === cat);
    for (const site of sites) {
      const gt = groundTruth.find(g => g.name === site.name);
      const cr = chelipedRes.find(r => r.name === site.name);
      const pr = playwrightRes.find(r => r.name === site.name);
      const pp = puppeteerRes.find(r => r.name === site.name);
      const td = tandemRes.find(r => r.name === site.name);

      console.log(`**${site.name}** (${site.url})`);
      if (gt && !gt.error) {
        console.log(`  DOM complexity: ${gt.totalDomNodes.toLocaleString()} nodes`);
      }

      if (!cr?.success) {
        console.log(`  Cheliped: ❌ ${cr?.error || 'not run'}`);
      } else {
        console.log(`  Cheliped: ${cr.tokens.toLocaleString()} tok, observe ${cr.observeTime}ms, extract(text) ${cr.extractTextTime}ms, extract(links) ${cr.extractLinksTime}ms`);
        console.log(`    → Links: ${cr.links}, Buttons: ${cr.buttons}, Inputs: ${cr.inputs}, Headings: ${cr.headings}, Images: ${cr.images}`);
      }

      if (pr?.success) {
        console.log(`  Playwright: ${pr.tokens.toLocaleString()} tok, ${pr.observeTime}ms`);
        console.log(`    → Links: ${pr.links}, Buttons: ${pr.buttons}, Inputs: ${pr.inputs}, Headings: ${pr.headings}`);
      }
      if (pp?.success) {
        console.log(`  Puppeteer: ${pp.tokens.toLocaleString()} tok, ${pp.observeTime}ms`);
        console.log(`    → Links: ${pp.links}, Buttons: ${pp.buttons}, Inputs: ${pp.inputs}, Headings: ${pp.headings}`);
      }
      if (td?.success) {
        console.log(`  Tandem: ${td.tokens.toLocaleString()} tok, ${td.observeTime}ms`);
        console.log(`    → Links: ${td.links}, Buttons: ${td.buttons}, Inputs: ${td.inputs}, Headings: ${td.headings}`);
      }
      console.log('');
    }
  }

  // ─── Summary ───────────────────────────────────────────────────

  console.log('═'.repeat(72));
  console.log('📋 CHALLENGE SUMMARY');
  console.log('═'.repeat(72));
  console.log('');

  const chOk = chelipedRes.filter(r => r.success);
  const pwOk = playwrightRes.filter(r => r.success);
  const ppOk = puppeteerRes.filter(r => r.success);
  const tdOk = tandemRes.filter(r => r.success);

  console.log(`Navigation success: Cheliped ${chOk.length}/${CHALLENGES.length} | Playwright ${pwOk.length}/${CHALLENGES.length} | Puppeteer ${ppOk.length}/${CHALLENGES.length} | Tandem ${tdOk.length}/${CHALLENGES.length}`);

  if (chOk.length > 0) {
    const avgTok = Math.round(chOk.reduce((s, r) => s + r.tokens, 0) / chOk.length);
    const avgObs = Math.round(chOk.reduce((s, r) => s + r.observeTime, 0) / chOk.length);
    const avgExtText = Math.round(chOk.reduce((s, r) => s + r.extractTextTime, 0) / chOk.length);
    const avgExtLinks = Math.round(chOk.reduce((s, r) => s + r.extractLinksTime, 0) / chOk.length);
    console.log(`Cheliped avg: ${avgTok} tok | observe ${avgObs}ms | extract(text) ${avgExtText}ms | extract(links) ${avgExtLinks}ms`);
  }
  if (pwOk.length > 0) {
    const avgTok = Math.round(pwOk.reduce((s, r) => s + r.tokens, 0) / pwOk.length);
    const avgObs = Math.round(pwOk.reduce((s, r) => s + r.observeTime, 0) / pwOk.length);
    console.log(`Playwright avg: ${avgTok} tok | ${avgObs}ms`);
  }
  if (ppOk.length > 0) {
    const avgTok = Math.round(ppOk.reduce((s, r) => s + r.tokens, 0) / ppOk.length);
    const avgObs = Math.round(ppOk.reduce((s, r) => s + r.observeTime, 0) / ppOk.length);
    console.log(`Puppeteer avg: ${avgTok} tok | ${avgObs}ms`);
  }
  if (tdOk.length > 0) {
    const avgTok = Math.round(tdOk.reduce((s, r) => s + r.tokens, 0) / tdOk.length);
    const avgObs = Math.round(tdOk.reduce((s, r) => s + r.observeTime, 0) / tdOk.length);
    console.log(`Tandem avg: ${avgTok} tok | ${avgObs}ms`);
  }

  // Identify problem areas for Cheliped
  console.log('');
  console.log('## Problem Areas for Cheliped');
  console.log('');
  for (const cr of chOk) {
    const gt = groundTruth.find(g => g.name === cr.name);
    if (!gt || gt.error) continue;

    const issues = [];
    if (cr.observeTime > 500) issues.push(`slow observe (${cr.observeTime}ms)`);
    if (cr.tokens > 15000) issues.push(`high tokens (${cr.tokens.toLocaleString()})`);
    if (gt.links > 10 && cr.links / gt.links < 0.5) issues.push(`low link recall (${cr.links}/${gt.links})`);
    if (gt.buttons > 3 && cr.buttons / gt.buttons < 0.5) issues.push(`low button recall (${cr.buttons}/${gt.buttons})`);
    if (gt.inputs > 2 && cr.inputs / gt.inputs < 0.5) issues.push(`low input recall (${cr.inputs}/${gt.inputs})`);
    if (gt.headings > 3 && cr.headings / gt.headings < 0.5) issues.push(`low heading recall (${cr.headings}/${gt.headings})`);

    if (issues.length > 0) {
      console.log(`  ⚠️ ${cr.name}: ${issues.join(', ')}`);
    }
  }

  console.log('');
  console.log('Done. 🦀');
}

main().catch(err => {
  console.error('Challenge benchmark failed:', err.message);
  process.exit(1);
});
