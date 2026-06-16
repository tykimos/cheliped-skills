#!/usr/bin/env node
// benchmark.mjs — Cheliped Browser Performance Benchmark
// Measures: token efficiency, speed, DOM coverage

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadCheliped() {
  try {
    const mod = await import('cheliped-browser');
    return mod.Cheliped;
  } catch {
    const distPath = resolve(__dirname, 'dist/index.js');
    const mod = await import(distPath);
    return mod.Cheliped;
  }
}

// Rough token count (GPT-style: ~4 chars per token)
function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.ceil(str.length / 4);
}

function formatNumber(n) {
  return n.toLocaleString();
}

function formatMs(ms) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function compressionRatio(original, compressed) {
  if (original === 0) return '0%';
  const ratio = ((1 - compressed / original) * 100).toFixed(1);
  return `${ratio}%`;
}

const TARGETS = [
  { name: 'Hacker News', url: 'https://news.ycombinator.com' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Web_browser' },
  { name: 'GitHub', url: 'https://github.com/trending' },
  { name: 'Example.com', url: 'https://example.com' },
  { name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/' },
];

async function runBenchmark() {
  console.log('');
  console.log('🦀 Cheliped Browser — Performance Benchmark');
  console.log('═'.repeat(70));
  console.log('');

  const Cheliped = await loadCheliped();
  const cheliped = new Cheliped({
    headless: true,
    compression: { enabled: true, maxTextLength: 200, maxTexts: 80, maxLinks: 50 },
  });

  console.log('Launching Chrome...');
  const launchStart = performance.now();
  await cheliped.launch();
  const launchTime = performance.now() - launchStart;
  console.log(`Chrome launched in ${formatMs(launchTime)}`);
  console.log('');

  const results = [];

  for (const target of TARGETS) {
    console.log(`Testing: ${target.name} (${target.url})`);
    const result = { name: target.name, url: target.url };

    try {
      // 1. Navigation timing
      const navStart = performance.now();
      await cheliped.goto(target.url);
      result.navTime = performance.now() - navStart;

      // 2. Get raw HTML size (for comparison)
      const rawHtml = await cheliped.runJs('document.documentElement.outerHTML');
      result.rawHtmlChars = typeof rawHtml === 'string' ? rawHtml.length : 0;
      result.rawHtmlTokens = estimateTokens(rawHtml);

      // 3. Get raw text size
      const rawText = await cheliped.runJs('document.body.innerText');
      result.rawTextChars = typeof rawText === 'string' ? rawText.length : 0;
      result.rawTextTokens = estimateTokens(rawText);

      // 4. Observe timing + Agent DOM size
      const observeStart = performance.now();
      const agentDom = await cheliped.observe();
      result.observeTime = performance.now() - observeStart;

      const agentDomStr = JSON.stringify(agentDom);
      result.agentDomChars = agentDomStr.length;
      result.agentDomTokens = estimateTokens(agentDomStr);

      // 5. DOM coverage
      result.nodeCount = (agentDom.buttons?.length ?? 0)
        + (agentDom.links?.length ?? 0)
        + (agentDom.inputs?.length ?? 0)
        + (agentDom.selects?.length ?? 0)
        + (agentDom.textareas?.length ?? 0)
        + (agentDom.images?.length ?? 0);
      result.textCount = agentDom.texts ? agentDom.texts.length : 0;
      result.linkCount = agentDom.links ? agentDom.links.length : 0;

      // 6. Observe-graph timing
      const graphStart = performance.now();
      const graph = await cheliped.observeGraph();
      result.graphTime = performance.now() - graphStart;

      const graphStr = JSON.stringify(graph);
      result.graphTokens = estimateTokens(graphStr);
      result.graphNodes = graph.nodes ? graph.nodes.length : 0;
      result.graphEdges = graph.edges ? graph.edges.length : 0;
      result.graphForms = graph.forms ? graph.forms.length : 0;

      // 7. Actions detection
      const actionsStart = performance.now();
      const actions = await cheliped.actions();
      result.actionsTime = performance.now() - actionsStart;
      result.actionsCount = actions ? actions.length : 0;
      result.actionsNames = actions ? actions.map(a => a.type || a.id).join(', ') : '';

      // 8. Screenshot timing
      const ssStart = performance.now();
      await cheliped.screenshot();
      result.screenshotTime = performance.now() - ssStart;

      result.success = true;
    } catch (e) {
      result.success = false;
      result.error = e.message;
    }

    results.push(result);
    console.log(`  ${result.success ? '✅' : '❌'} Done (${formatMs(result.navTime || 0)})`);
  }

  // 9. Search benchmark
  console.log('');
  console.log('── Search Benchmark ──');

  const SEARCH_TARGETS = [
    { engine: 'google', query: 'browser automation AI agent' },
    { engine: 'naver', query: '브라우저 자동화 AI' },
    { engine: 'bing', query: 'browser automation AI agent' },
    { engine: 'duckduckgo', query: 'browser automation AI agent' },
    { engine: 'baidu', query: '浏览器自动化 AI' },
    { engine: 'yandex', query: 'browser automation AI agent' },
    { engine: 'yahoo_japan', query: 'ブラウザ自動化 AI' },
    { engine: 'ecosia', query: 'browser automation AI agent' },
  ];

  const searchResults = [];

  for (const st of SEARCH_TARGETS) {
    console.log(`  Searching: ${st.engine} "${st.query}"`);
    const sr = { engine: st.engine, query: st.query };
    try {
      const searchStart = performance.now();
      const res = await cheliped.search(st.query, st.engine);
      sr.time = performance.now() - searchStart;
      sr.count = res.results.length;
      sr.tokens = estimateTokens(JSON.stringify(res));
      sr.success = true;
    } catch (e) {
      sr.success = false;
      sr.error = e.message;
      sr.time = 0;
      sr.count = 0;
      sr.tokens = 0;
    }
    searchResults.push(sr);
    console.log(`    ${sr.success ? '✅' : '❌'} ${sr.count} results in ${formatMs(sr.time)}`);
  }

  await cheliped.close();

  // Print results
  console.log('');
  console.log('');
  console.log('═'.repeat(70));
  console.log('📊 RESULTS');
  console.log('═'.repeat(70));

  // Table 1: Token Efficiency
  console.log('');
  console.log('## Token Efficiency (Agent DOM vs Raw HTML)');
  console.log('');
  console.log('| Site | Raw HTML | Raw Text | Agent DOM | Compression |');
  console.log('|------|---------|----------|-----------|-------------|');
  for (const r of results) {
    if (!r.success) {
      console.log(`| ${r.name} | ❌ Error | | | |`);
      continue;
    }
    console.log(`| ${r.name} | ${formatNumber(r.rawHtmlTokens)} tok | ${formatNumber(r.rawTextTokens)} tok | ${formatNumber(r.agentDomTokens)} tok | ${compressionRatio(r.rawHtmlTokens, r.agentDomTokens)} |`);
  }

  // Table 2: Speed
  console.log('');
  console.log('## Speed (milliseconds)');
  console.log('');
  console.log('| Site | Navigate | Observe | Graph | Actions | Screenshot |');
  console.log('|------|----------|---------|-------|---------|------------|');
  for (const r of results) {
    if (!r.success) {
      console.log(`| ${r.name} | ❌ | | | | |`);
      continue;
    }
    console.log(`| ${r.name} | ${formatMs(r.navTime)} | ${formatMs(r.observeTime)} | ${formatMs(r.graphTime)} | ${formatMs(r.actionsTime)} | ${formatMs(r.screenshotTime)} |`);
  }

  // Table 3: DOM Coverage
  console.log('');
  console.log('## Agent DOM Coverage');
  console.log('');
  console.log('| Site | Nodes | Texts | Links | Graph Nodes | Graph Edges | Forms | Actions |');
  console.log('|------|-------|-------|-------|-------------|-------------|-------|---------|');
  for (const r of results) {
    if (!r.success) {
      console.log(`| ${r.name} | ❌ | | | | | | |`);
      continue;
    }
    console.log(`| ${r.name} | ${r.nodeCount} | ${r.textCount} | ${r.linkCount} | ${r.graphNodes} | ${r.graphEdges} | ${r.graphForms} | ${r.actionsCount} |`);
  }

  // Table 4: Detected Actions
  console.log('');
  console.log('## Detected Semantic Actions');
  console.log('');
  for (const r of results) {
    if (!r.success || !r.actionsCount) continue;
    console.log(`- **${r.name}**: ${r.actionsNames}`);
  }

  // Table 5: Search Performance
  console.log('');
  console.log('## Search Performance (free alternative to search APIs)');
  console.log('');
  console.log('| Engine | Query | Results | Time | Tokens | $/1k equiv |');
  console.log('|--------|-------|---------|------|--------|------------|');
  const apiCosts = { google: '$10 (WebSearch)', naver: 'N/A', bing: '$5 (Brave)', duckduckgo: '$0.8 (Tavily)', baidu: 'N/A', yandex: 'N/A', yahoo_japan: 'N/A', ecosia: 'N/A' };
  for (const sr of searchResults) {
    if (!sr.success) {
      console.log(`| ${sr.engine} | ${sr.query.slice(0, 20)} | ❌ | | | |`);
      continue;
    }
    console.log(`| ${sr.engine} | ${sr.query.slice(0, 20)} | ${sr.count} | ${formatMs(sr.time)} | ${formatNumber(sr.tokens)} | **$0** vs ${apiCosts[sr.engine]} |`);
  }

  // Summary
  console.log('');
  console.log('═'.repeat(70));
  console.log('📈 SUMMARY');
  console.log('═'.repeat(70));

  const successResults = results.filter(r => r.success);
  if (successResults.length > 0) {
    const avgCompression = successResults.reduce((sum, r) => {
      return sum + (1 - r.agentDomTokens / r.rawHtmlTokens);
    }, 0) / successResults.length * 100;

    const avgObserve = successResults.reduce((sum, r) => sum + r.observeTime, 0) / successResults.length;
    const avgNav = successResults.reduce((sum, r) => sum + r.navTime, 0) / successResults.length;
    const totalNodes = successResults.reduce((sum, r) => sum + r.nodeCount, 0);
    const totalActions = successResults.reduce((sum, r) => sum + r.actionsCount, 0);

    console.log('');
    console.log(`  Chrome Launch:       ${formatMs(launchTime)}`);
    console.log(`  Avg Navigation:      ${formatMs(avgNav)}`);
    console.log(`  Avg Observe:         ${formatMs(avgObserve)}`);
    console.log(`  Avg Compression:     ${avgCompression.toFixed(1)}% token reduction vs raw HTML`);
    console.log(`  Total Nodes Found:   ${totalNodes}`);
    console.log(`  Total Actions Found: ${totalActions}`);
    console.log(`  Success Rate:        ${successResults.length}/${results.length} (${(successResults.length/results.length*100).toFixed(0)}%)`);

    // Search summary
    const successSearches = searchResults.filter(s => s.success);
    if (successSearches.length > 0) {
      const avgSearchTime = successSearches.reduce((sum, s) => sum + s.time, 0) / successSearches.length;
      const avgSearchResults = successSearches.reduce((sum, s) => sum + s.count, 0) / successSearches.length;
      const avgSearchTokens = successSearches.reduce((sum, s) => sum + s.tokens, 0) / successSearches.length;
      console.log('');
      console.log(`  --- Search ---`);
      console.log(`  Avg Search Time:     ${formatMs(avgSearchTime)}`);
      console.log(`  Avg Results/Query:   ${avgSearchResults.toFixed(1)}`);
      console.log(`  Avg Tokens/Query:    ${formatNumber(Math.round(avgSearchTokens))}`);
      console.log(`  Search Cost:         $0 (vs $5-10/1k with APIs)`);
      console.log(`  Engines Tested:      ${successSearches.length}/${searchResults.length}`);
    }
  }

  console.log('');
  console.log('Done. 🦀');
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
