#!/usr/bin/env node
// benchmark-quality.mjs — Content Recognition Quality Benchmark
// Measures: text recall, link accuracy, interactive element detection, content fidelity
// Compares Cheliped vs agent-browser vs Playwright vs Puppeteer vs Tandem

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Ground Truth Collection (via Playwright evaluate) ──────────

async function collectGroundTruth(targets) {
  console.log('  📏 Collecting ground truth via Playwright evaluate...');

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('  ❌ Playwright required for ground truth. Run: pnpm add playwright');
    process.exit(1);
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  for (const target of targets) {
    console.log(`    → ${target.name}...`);
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000); // let dynamic content settle

      const truth = await page.evaluate(() => {
        // Visible text extraction
        const walker = document.createTreeWalker(
          document.body, NodeFilter.SHOW_TEXT,
          { acceptNode: (n) => {
            const el = n.parentElement;
            if (!el) return NodeFilter.FILTER_REJECT;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(el.tagName)) return NodeFilter.FILTER_REJECT;
            return n.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }}
        );
        const visibleTexts = [];
        while (walker.nextNode()) {
          const t = walker.currentNode.textContent.trim();
          if (t.length >= 3) visibleTexts.push(t);
        }

        // Links
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
          const rect = a.getBoundingClientRect();
          const style = getComputedStyle(a);
          if (rect.width === 0 && rect.height === 0) return;
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const text = (a.textContent || '').trim();
          if (text.length > 0) {
            links.push({ text: text.substring(0, 100), href: a.href });
          }
        });

        // Buttons
        const buttons = [];
        document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(b => {
          const rect = b.getBoundingClientRect();
          const style = getComputedStyle(b);
          if (rect.width === 0 && rect.height === 0) return;
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const text = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
          buttons.push({ text: text.substring(0, 100), type: b.type || 'button' });
        });

        // Input fields
        const inputs = [];
        document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select').forEach(inp => {
          const rect = inp.getBoundingClientRect();
          const style = getComputedStyle(inp);
          if (rect.width === 0 && rect.height === 0) return;
          if (style.display === 'none' || style.visibility === 'hidden') return;
          inputs.push({
            tag: inp.tagName.toLowerCase(),
            type: inp.type || 'text',
            name: inp.name || '',
            placeholder: inp.placeholder || '',
          });
        });

        // Images
        const images = [];
        document.querySelectorAll('img[src]').forEach(img => {
          const rect = img.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;
          images.push({
            alt: img.alt || '',
            src: img.src.substring(0, 200),
          });
        });

        // Headings
        const headings = [];
        document.querySelectorAll('h1, h2, h3').forEach(h => {
          const text = (h.textContent || '').trim();
          if (text) headings.push(text.substring(0, 200));
        });

        return {
          visibleTextCount: visibleTexts.length,
          visibleTextSample: visibleTexts.slice(0, 200),
          allVisibleText: visibleTexts.join(' ').substring(0, 50000),
          links: links.slice(0, 500),
          buttons,
          inputs,
          images: images.slice(0, 100),
          headings,
          title: document.title,
        };
      });

      results.push({ name: target.name, url: target.url, truth });
    } catch (e) {
      console.log(`    ⚠️ Failed: ${e.message.substring(0, 80)}`);
      results.push({ name: target.name, url: target.url, truth: null });
    }
  }

  await browser.close();
  return results;
}

// ─── Tool Outputs ────────────────────────────────────────────────

async function getChelipedOutput(targets) {
  console.log('  🦀 Cheliped...');
  const results = [];

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

  for (const target of targets) {
    try {
      await cheliped.goto(target.url);
      const dom = await cheliped.observe();

      // Flatten all text content from the output
      const allText = [
        ...(dom.texts || []).map(t => t.text || ''),
        ...(dom.links || []).map(l => l.text || ''),
        ...(dom.buttons || []).map(b => b.text || ''),
        ...(dom.inputs || []).map(i => i.placeholder || i.name || ''),
        ...(dom.images || []).map(i => i.alt || i.text || ''),
      ].join(' ');

      results.push({
        name: target.name,
        tool: 'Cheliped',
        links: (dom.links || []).map(l => ({ text: (l.text || '').substring(0, 100), href: l.href || '' })),
        buttons: (dom.buttons || []).map(b => ({ text: (b.text || '').substring(0, 100) })),
        inputs: (dom.inputs || []).map(i => ({
          type: i.type || 'text',
          name: i.name || '',
          placeholder: i.placeholder || '',
        })),
        images: (dom.images || []).map(i => ({ alt: i.alt || i.text || '', src: i.src || '' })),
        headings: [...(dom.texts || []), ...(dom.links || []), ...(dom.buttons || [])].filter(t => t.tag === 'h1' || t.tag === 'h2' || t.tag === 'h3').map(t => t.text || ''),
        allText,
        success: true,
      });
    } catch (e) {
      results.push({ name: target.name, tool: 'Cheliped', success: false, error: e.message });
    }
  }

  await cheliped.close();
  return results;
}

async function getPlaywrightOutput(targets) {
  console.log('  🎭 Playwright ariaSnapshot...');
  const results = [];

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return results;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const target of targets) {
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const snapshot = await page.locator('body').ariaSnapshot();

      // Parse aria snapshot text format
      const lines = snapshot.split('\n');
      const links = [];
      const buttons = [];
      const inputs = [];
      const headings = [];
      const allTextParts = [];

      for (const line of lines) {
        const trimmed = line.trim();
        // - link "text"
        const linkMatch = trimmed.match(/^- link "(.+?)"/);
        if (linkMatch) {
          const urlMatch = trimmed.match(/\/url:\s*(.+)/);
          links.push({ text: linkMatch[1], href: urlMatch ? urlMatch[1] : '' });
        }
        // - button "text"
        const btnMatch = trimmed.match(/^- button "(.+?)"/);
        if (btnMatch) buttons.push({ text: btnMatch[1] });
        // - textbox / searchbox
        const inputMatch = trimmed.match(/^- (textbox|searchbox|combobox) "(.+?)"/);
        if (inputMatch) inputs.push({ type: inputMatch[1], name: inputMatch[2], placeholder: '' });
        // - heading "text"
        const headMatch = trimmed.match(/^- heading "(.+?)"/);
        if (headMatch) headings.push(headMatch[1]);
        // Collect all quoted text
        const textMatch = trimmed.match(/"([^"]+)"/g);
        if (textMatch) allTextParts.push(...textMatch.map(t => t.replace(/"/g, '')));
        // - paragraph: text
        const paraMatch = trimmed.match(/^- paragraph:\s*(.+)/);
        if (paraMatch) allTextParts.push(paraMatch[1]);
        // - text: content
        const textContentMatch = trimmed.match(/^- text:\s*(.+)/);
        if (textContentMatch) allTextParts.push(textContentMatch[1]);
      }

      results.push({
        name: target.name,
        tool: 'Playwright',
        links, buttons, inputs,
        images: [], // ariaSnapshot doesn't reliably expose images
        headings,
        allText: allTextParts.join(' '),
        success: true,
      });
    } catch (e) {
      results.push({ name: target.name, tool: 'Playwright', success: false, error: e.message });
    }
  }

  await browser.close();
  return results;
}

async function getPuppeteerOutput(targets) {
  console.log('  🤖 Puppeteer a11y snapshot...');
  const results = [];

  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    return results;
  }

  const browser = await puppeteer.default.launch({ headless: 'new' });
  const page = await browser.newPage();

  for (const target of targets) {
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const snapshot = await page.accessibility.snapshot({ interestingOnly: false });

      // Walk a11y tree
      const links = [];
      const buttons = [];
      const inputs = [];
      const headings = [];
      const allTextParts = [];

      function walk(node) {
        if (!node) return;
        const name = node.name || '';
        if (name) allTextParts.push(name);

        if (node.role === 'link' && name) links.push({ text: name.substring(0, 100), href: '' });
        if (node.role === 'button' && name) buttons.push({ text: name.substring(0, 100) });
        if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(node.role)) {
          inputs.push({ type: node.role, name, placeholder: '' });
        }
        if (node.role === 'heading' && name) headings.push(name);

        if (node.children) node.children.forEach(walk);
      }
      walk(snapshot);

      results.push({
        name: target.name,
        tool: 'Puppeteer',
        links, buttons, inputs,
        images: [],
        headings,
        allText: allTextParts.join(' '),
        success: true,
      });
    } catch (e) {
      results.push({ name: target.name, tool: 'Puppeteer', success: false, error: e.message });
    }
  }

  await browser.close();
  return results;
}

function getAgentBrowserOutput(targets) {
  console.log('  🔷 agent-browser...');
  const results = [];

  for (const target of targets) {
    try {
      execSync(`agent-browser open "${target.url}"`, { timeout: 30000, stdio: 'pipe' });
      const snapshot = execSync('agent-browser snapshot', {
        timeout: 15000, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
      }).toString();

      const lines = snapshot.split('\n');
      const links = [];
      const buttons = [];
      const inputs = [];
      const headings = [];
      const allTextParts = [];

      for (const line of lines) {
        const trimmed = line.trim();
        // agent-browser uses similar ARIA-like text format
        const linkMatch = trimmed.match(/link\s+"(.+?)"/i) || trimmed.match(/\[(.+?)\]\((.+?)\)/);
        if (linkMatch) links.push({ text: linkMatch[1], href: linkMatch[2] || '' });

        const btnMatch = trimmed.match(/button\s+"(.+?)"/i);
        if (btnMatch) buttons.push({ text: btnMatch[1] });

        const inputMatch = trimmed.match(/(textbox|searchbox|text\s+field)\s+"(.+?)"/i);
        if (inputMatch) inputs.push({ type: inputMatch[1], name: inputMatch[2], placeholder: '' });

        const headMatch = trimmed.match(/heading\s+"(.+?)"/i);
        if (headMatch) headings.push(headMatch[1]);

        // Collect quoted text
        const quotes = trimmed.match(/"([^"]{2,})"/g);
        if (quotes) allTextParts.push(...quotes.map(q => q.replace(/"/g, '')));

        // Also plain text lines
        if (trimmed.length > 3 && !trimmed.startsWith('@')) allTextParts.push(trimmed);
      }

      results.push({
        name: target.name,
        tool: 'agent-browser',
        links, buttons, inputs,
        images: [],
        headings,
        allText: allTextParts.join(' '),
        success: true,
      });
    } catch (e) {
      results.push({ name: target.name, tool: 'agent-browser', success: false, error: e.message?.substring(0, 80) });
    }
  }

  try { execSync('agent-browser close', { timeout: 5000, stdio: 'pipe' }); } catch {}
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

function tandemCountNodes(nodes) {
  let count = 0;
  for (const node of nodes) {
    count++;
    count += tandemCountNodes(node.children);
  }
  return count;
}

async function getTandemOutput(targets) {
  console.log('  Tandem (AXTree via CDP)...');
  const results = [];

  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.log('    Puppeteer not installed, skipping Tandem benchmark.');
    return results;
  }

  const browser = await puppeteer.default.launch({ headless: 'new' });
  const page = await browser.newPage();
  const client = await page.createCDPSession();

  for (const target of targets) {
    try {
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      await client.send('Accessibility.enable');
      const axResult = await client.send('Accessibility.getFullAXTree');
      const rawNodes = axResult.nodes || [];

      let tree = tandemBuildTree(rawNodes);
      tree = tandemFilterCompact(tree);

      // Walk the compact tree to extract categorized elements
      const links = [];
      const buttons = [];
      const inputs = [];
      const headings = [];
      const allTextParts = [];

      function walk(node) {
        if (!node) return;
        const name = node.name || '';
        if (name) allTextParts.push(name);

        if (node.role === 'link' && name) links.push({ text: name.substring(0, 100), href: '' });
        if (node.role === 'button' && name) buttons.push({ text: name.substring(0, 100) });
        if (['textbox', 'searchbox', 'combobox', 'checkbox', 'radio'].includes(node.role)) {
          inputs.push({ type: node.role, name, placeholder: '' });
        }
        if (node.role === 'heading' && name) headings.push(name);

        if (node.children) node.children.forEach(walk);
      }
      tree.forEach(walk);

      results.push({
        name: target.name,
        tool: 'Tandem',
        links, buttons, inputs,
        images: [],
        headings,
        allText: allTextParts.join(' '),
        success: true,
      });
    } catch (e) {
      results.push({ name: target.name, tool: 'Tandem', success: false, error: e.message?.substring(0, 80) });
    }
  }

  await browser.close();
  return results;
}

// ─── Quality Metrics ─────────────────────────────────────────────

function computeTextRecall(truth, toolOutput) {
  // What % of ground-truth visible text fragments appear in the tool output?
  if (!truth || !toolOutput?.allText) return 0;
  const toolText = toolOutput.allText.toLowerCase();
  let found = 0;
  const samples = truth.visibleTextSample;
  for (const text of samples) {
    const normalized = text.toLowerCase().trim();
    if (normalized.length < 3) continue;
    // Check if key words from the text appear in tool output
    const words = normalized.split(/\s+/).filter(w => w.length >= 4);
    if (words.length === 0) continue;
    const matchedWords = words.filter(w => toolText.includes(w));
    if (matchedWords.length / words.length >= 0.5) found++;
  }
  return samples.length > 0 ? found / samples.length : 0;
}

function computeLinkRecall(truth, toolOutput) {
  if (!truth || !toolOutput?.links) return { recall: 0, precision: 0, found: 0, total: 0 };
  const truthLinks = truth.links;
  const toolLinks = toolOutput.links;

  // Match by text similarity
  let found = 0;
  for (const tl of truthLinks) {
    const tlText = tl.text.toLowerCase().trim();
    if (tlText.length < 2) continue;
    const match = toolLinks.some(ol => {
      const olText = (ol.text || '').toLowerCase().trim();
      return olText === tlText || olText.includes(tlText) || tlText.includes(olText);
    });
    if (match) found++;
  }

  const recall = truthLinks.length > 0 ? found / truthLinks.length : 0;
  const precision = toolLinks.length > 0 ? Math.min(found / toolLinks.length, 1) : 0;

  return { recall, precision, found, total: truthLinks.length, detected: toolLinks.length };
}

function computeButtonRecall(truth, toolOutput) {
  if (!truth || !toolOutput?.buttons) return { recall: 0, found: 0, total: 0 };
  const truthBtns = truth.buttons;
  const toolBtns = toolOutput.buttons;

  let found = 0;
  for (const tb of truthBtns) {
    const tbText = tb.text.toLowerCase().trim();
    if (tbText.length < 1) continue;
    const match = toolBtns.some(ob => {
      const obText = (ob.text || '').toLowerCase().trim();
      return obText === tbText || obText.includes(tbText) || tbText.includes(obText);
    });
    if (match) found++;
  }

  return {
    recall: truthBtns.length > 0 ? found / truthBtns.length : (toolBtns.length === 0 ? 1 : 0),
    found, total: truthBtns.length, detected: toolBtns.length,
  };
}

function computeInputRecall(truth, toolOutput) {
  if (!truth || !toolOutput?.inputs) return { recall: 0, found: 0, total: 0 };
  const truthInputs = truth.inputs;
  const toolInputs = toolOutput.inputs;

  let found = 0;
  for (const ti of truthInputs) {
    const match = toolInputs.some(oi => {
      // Match by name, type, or placeholder
      if (ti.name && oi.name && ti.name.toLowerCase() === oi.name.toLowerCase()) return true;
      if (ti.placeholder && oi.placeholder && ti.placeholder.toLowerCase().includes(oi.placeholder.toLowerCase())) return true;
      if (ti.type === oi.type && ti.name === oi.name) return true;
      return false;
    });
    if (match) found++;
  }

  return {
    recall: truthInputs.length > 0 ? found / truthInputs.length : (toolInputs.length === 0 ? 1 : 0),
    found, total: truthInputs.length, detected: toolInputs.length,
  };
}

function computeHeadingRecall(truth, toolOutput) {
  if (!truth || !toolOutput?.headings) return { recall: 0, found: 0, total: 0 };
  const truthH = truth.headings;
  const toolH = toolOutput.headings;

  let found = 0;
  for (const th of truthH) {
    const thText = th.toLowerCase().trim();
    const match = toolH.some(oh => {
      const ohText = (oh || '').toLowerCase().trim();
      return ohText === thText || ohText.includes(thText) || thText.includes(ohText);
    });
    if (match) found++;
  }

  return {
    recall: truthH.length > 0 ? found / truthH.length : (toolH.length === 0 ? 1 : 0),
    found, total: truthH.length, detected: toolH.length,
  };
}

// ─── Main ────────────────────────────────────────────────────────

const TARGETS = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Web_browser' },
  { name: 'GitHub', url: 'https://github.com/trending' },
  { name: 'Example.com', url: 'https://example.com' },
  { name: 'React (TodoMVC)', url: 'https://todomvc.com/examples/react/dist/' },
  { name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML' },
];

async function main() {
  console.log('');
  console.log('🦀 Cheliped Browser — Content Recognition Quality Benchmark');
  console.log('═'.repeat(72));
  console.log('');
  console.log('Measures how accurately each tool captures real page content.');
  console.log(`Sites: ${TARGETS.map(t => t.name).join(', ')}`);
  console.log('');

  // Step 1: Ground truth
  const groundTruths = await collectGroundTruth(TARGETS);

  // Step 2: Each tool's output
  const chelipedOut = await getChelipedOutput(TARGETS);
  const agentBrOut = getAgentBrowserOutput(TARGETS);

  let playwrightOut = [];
  try {
    playwrightOut = await getPlaywrightOutput(TARGETS);
  } catch (e) {
    console.log(`  ⚠️ Playwright failed: ${e.message}`);
  }

  let puppeteerOut = [];
  try {
    puppeteerOut = await getPuppeteerOutput(TARGETS);
  } catch (e) {
    console.log(`  ⚠️ Puppeteer failed: ${e.message}`);
  }

  let tandemOut = [];
  try {
    tandemOut = await getTandemOutput(TARGETS);
  } catch (e) {
    console.log(`  ⚠️ Tandem failed: ${e.message}`);
  }

  const tools = [
    { name: 'Cheliped', outputs: chelipedOut },
    { name: 'agent-browser', outputs: agentBrOut },
    { name: 'Playwright', outputs: playwrightOut },
    { name: 'Puppeteer', outputs: puppeteerOut },
    { name: 'Tandem', outputs: tandemOut },
  ];

  // Step 3: Compute metrics
  console.log('');
  console.log('');
  console.log('═'.repeat(72));
  console.log('📊 CONTENT RECOGNITION QUALITY');
  console.log('═'.repeat(72));

  // Ground truth summary
  console.log('');
  console.log('## Ground Truth (actual visible content)');
  console.log('');
  console.log('| Site | Visible Texts | Links | Buttons | Inputs | Headings |');
  console.log('|------|--------------|-------|---------|--------|----------|');
  for (const gt of groundTruths) {
    if (!gt.truth) { console.log(`| ${gt.name} | — | — | — | — | — |`); continue; }
    const t = gt.truth;
    console.log(`| ${gt.name} | ${t.visibleTextCount} | ${t.links.length} | ${t.buttons.length} | ${t.inputs.length} | ${t.headings.length} |`);
  }

  // Text Recall
  console.log('');
  console.log('## Text Recall (% of visible text fragments recognized)');
  console.log('');
  const toolNames = tools.map(t => t.name).join(' | ');
  console.log(`| Site | ${toolNames} |`);
  console.log(`|------|${'----------|'.repeat(tools.length)}`);

  const textRecalls = {};
  for (const gt of groundTruths) {
    const cols = [];
    for (const tool of tools) {
      const out = tool.outputs.find(o => o.name === gt.name);
      const recall = out?.success ? computeTextRecall(gt.truth, out) : null;
      if (!textRecalls[tool.name]) textRecalls[tool.name] = [];
      textRecalls[tool.name].push(recall);
      cols.push(recall != null ? `${(recall * 100).toFixed(1)}%` : '❌');
    }
    console.log(`| ${gt.name} | ${cols.join(' | ')} |`);
  }

  // Link Recall & Precision
  console.log('');
  console.log('## Link Detection (Recall / Precision)');
  console.log('');
  console.log(`| Site | ${toolNames} |`);
  console.log(`|------|${'----------|'.repeat(tools.length)}`);

  const linkRecalls = {};
  for (const gt of groundTruths) {
    const cols = [];
    for (const tool of tools) {
      const out = tool.outputs.find(o => o.name === gt.name);
      const lr = out?.success ? computeLinkRecall(gt.truth, out) : null;
      if (!linkRecalls[tool.name]) linkRecalls[tool.name] = [];
      linkRecalls[tool.name].push(lr);
      if (lr) {
        cols.push(`${(lr.recall * 100).toFixed(0)}% / ${(lr.precision * 100).toFixed(0)}%`);
      } else {
        cols.push('❌');
      }
    }
    console.log(`| ${gt.name} | ${cols.join(' | ')} |`);
  }

  // Button Detection
  console.log('');
  console.log('## Button Detection (found / total ground-truth)');
  console.log('');
  console.log(`| Site | ${toolNames} |`);
  console.log(`|------|${'----------|'.repeat(tools.length)}`);

  for (const gt of groundTruths) {
    const cols = [];
    for (const tool of tools) {
      const out = tool.outputs.find(o => o.name === gt.name);
      const br = out?.success ? computeButtonRecall(gt.truth, out) : null;
      if (br) {
        cols.push(`${br.found}/${br.total} (det: ${br.detected})`);
      } else {
        cols.push('❌');
      }
    }
    console.log(`| ${gt.name} | ${cols.join(' | ')} |`);
  }

  // Input Detection
  console.log('');
  console.log('## Input Field Detection (found / total ground-truth)');
  console.log('');
  console.log(`| Site | ${toolNames} |`);
  console.log(`|------|${'----------|'.repeat(tools.length)}`);

  for (const gt of groundTruths) {
    const cols = [];
    for (const tool of tools) {
      const out = tool.outputs.find(o => o.name === gt.name);
      const ir = out?.success ? computeInputRecall(gt.truth, out) : null;
      if (ir) {
        cols.push(`${ir.found}/${ir.total} (det: ${ir.detected})`);
      } else {
        cols.push('❌');
      }
    }
    console.log(`| ${gt.name} | ${cols.join(' | ')} |`);
  }

  // Heading Detection
  console.log('');
  console.log('## Heading Detection (found / total ground-truth)');
  console.log('');
  console.log(`| Site | ${toolNames} |`);
  console.log(`|------|${'----------|'.repeat(tools.length)}`);

  for (const gt of groundTruths) {
    const cols = [];
    for (const tool of tools) {
      const out = tool.outputs.find(o => o.name === gt.name);
      const hr = out?.success ? computeHeadingRecall(gt.truth, out) : null;
      if (hr) {
        cols.push(`${hr.found}/${hr.total} (det: ${hr.detected})`);
      } else {
        cols.push('❌');
      }
    }
    console.log(`| ${gt.name} | ${cols.join(' | ')} |`);
  }

  // ─── Overall Score ─────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(72));
  console.log('📈 OVERALL QUALITY SCORE');
  console.log('═'.repeat(72));
  console.log('');
  console.log('Weighted: Text 25% + Link Recall 20% + Link Precision 10% + Button 15% + Input 15% + Heading 15%');
  console.log('');
  console.log(`| Metric | ${toolNames} |`);
  console.log(`|--------|${'----------|'.repeat(tools.length)}`);

  const overallScores = {};
  for (const tool of tools) {
    const trs = textRecalls[tool.name]?.filter(v => v != null) || [];
    const lrs = linkRecalls[tool.name]?.filter(v => v != null) || [];

    const avgTextRecall = trs.length > 0 ? trs.reduce((s, v) => s + v, 0) / trs.length : 0;
    const avgLinkRecall = lrs.length > 0 ? lrs.reduce((s, v) => s + v.recall, 0) / lrs.length : 0;
    const avgLinkPrecision = lrs.length > 0 ? lrs.reduce((s, v) => s + v.precision, 0) / lrs.length : 0;

    // Button, Input, Heading recall averages
    let btnRecalls = [];
    let inpRecalls = [];
    let hdgRecalls = [];
    for (const gt of groundTruths) {
      const out = tool.outputs.find(o => o.name === gt.name);
      if (out?.success && gt.truth) {
        const br = computeButtonRecall(gt.truth, out);
        btnRecalls.push(br.recall);
        const ir = computeInputRecall(gt.truth, out);
        inpRecalls.push(ir.recall);
        const hr = computeHeadingRecall(gt.truth, out);
        hdgRecalls.push(hr.recall);
      }
    }
    const avgBtnRecall = btnRecalls.length > 0 ? btnRecalls.reduce((s, v) => s + v, 0) / btnRecalls.length : 0;
    const avgInpRecall = inpRecalls.length > 0 ? inpRecalls.reduce((s, v) => s + v, 0) / inpRecalls.length : 0;
    const avgHdgRecall = hdgRecalls.length > 0 ? hdgRecalls.reduce((s, v) => s + v, 0) / hdgRecalls.length : 0;

    const overall = avgTextRecall * 0.25 + avgLinkRecall * 0.20 + avgLinkPrecision * 0.10
      + avgBtnRecall * 0.15 + avgInpRecall * 0.15 + avgHdgRecall * 0.15;

    overallScores[tool.name] = {
      textRecall: avgTextRecall,
      linkRecall: avgLinkRecall,
      linkPrecision: avgLinkPrecision,
      btnRecall: avgBtnRecall,
      inpRecall: avgInpRecall,
      hdgRecall: avgHdgRecall,
      overall,
    };
  }

  const pct = v => `${(v * 100).toFixed(1)}%`;
  const metricRows = [
    ['Text Recall', t => pct(overallScores[t]?.textRecall || 0)],
    ['Link Recall', t => pct(overallScores[t]?.linkRecall || 0)],
    ['Link Precision', t => pct(overallScores[t]?.linkPrecision || 0)],
    ['Button Recall', t => pct(overallScores[t]?.btnRecall || 0)],
    ['Input Recall', t => pct(overallScores[t]?.inpRecall || 0)],
    ['Heading Recall', t => pct(overallScores[t]?.hdgRecall || 0)],
    ['**Overall Score**', t => `**${pct(overallScores[t]?.overall || 0)}**`],
  ];

  for (const [label, fn] of metricRows) {
    const vals = tools.map(t => fn(t.name)).join(' | ');
    console.log(`| ${label} | ${vals} |`);
  }

  console.log('');
  console.log('Done. 🦀');
}

main().catch(err => {
  console.error('Quality benchmark failed:', err.message);
  process.exit(1);
});
