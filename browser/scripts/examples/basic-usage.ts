import { Cheliped } from '../src/index.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('Cheliped — Agent Browser Runtime Demo\n');

  const cheliped = new Cheliped({ headless: true });

  console.log('Launching Chrome...');
  await cheliped.launch();

  console.log('Navigating to https://example.com...');
  const result = await cheliped.goto('https://example.com');
  console.log(`Page loaded: ${result.title} (${result.url})\n`);

  console.log('Extracting Agent DOM...');
  const agentDom = await cheliped.observe();
  console.log(JSON.stringify(agentDom, null, 2));

  console.log('\nTaking screenshot...');
  const screenshot = await cheliped.screenshot();
  writeFileSync('example-screenshot.png', screenshot.buffer);
  console.log('Screenshot saved to example-screenshot.png');

  console.log('\nRunning JavaScript...');
  const title = await cheliped.runJs('document.title');
  console.log(`document.title = "${title}"`);

  await cheliped.close();
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
