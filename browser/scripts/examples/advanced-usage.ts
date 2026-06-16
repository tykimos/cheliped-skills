import { Cheliped } from '../src/index.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('Cheliped — Phase 2 Advanced Demo\n');

  // Launch with compression and security
  const cheliped = new Cheliped({
    headless: true,
    compression: {
      enabled: true,
      maxTextLength: 200,
      maxLinks: 10,
    },
    security: {
      domainAllowlist: ['example.com', '*.iana.org'],
      enablePromptGuard: true,
    },
  });

  await cheliped.launch();
  console.log('Chrome launched with security policy\n');

  // Navigate
  const result = await cheliped.goto('https://example.com');
  console.log(`Page: ${result.title} (${result.url})\n`);

  // Observe compressed Agent DOM
  console.log('--- Agent DOM (compressed) ---');
  const agentDom = await cheliped.observe();
  console.log(JSON.stringify(agentDom, null, 2));

  // Observe UI Graph
  console.log('\n--- UI Graph ---');
  const graph = await cheliped.observeGraph();
  console.log(`Nodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  console.log(`Forms: ${graph.forms.length}`);
  for (const node of graph.nodes.slice(0, 5)) {
    console.log(`  [${node.type}] ${node.label}`);
  }

  // Discover semantic actions
  console.log('\n--- Semantic Actions ---');
  const actions = await cheliped.actions();
  for (const action of actions) {
    console.log(`  ${action.id} (${action.type}) confidence=${action.confidence}`);
    if (action.params.length > 0) {
      console.log(`    params: ${action.params.map(p => p.name).join(', ')}`);
    }
  }

  // Check for prompt injection
  console.log('\n--- Security ---');
  const injection = await cheliped.checkPromptInjection();
  console.log(`Prompt injection detected: ${injection.injectionDetected}`);
  console.log(`Security violations: ${cheliped.getSecurityViolations().length}`);

  // Screenshot
  const screenshot = await cheliped.screenshot();
  writeFileSync('advanced-screenshot.png', screenshot.buffer);
  console.log('\nScreenshot saved to advanced-screenshot.png');

  await cheliped.close();
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
