import { Cheliped } from '../src/index.js';
import { writeFileSync } from 'fs';

async function browse() {
  const cheliped = new Cheliped({ headless: true });
  await cheliped.launch();

  console.log('=== Instagram 접속 ===');
  await cheliped.goto('https://www.instagram.com/tyri.unnie/');
  await new Promise(r => setTimeout(r, 3000)); // Instagram은 JS 렌더링 대기 필요

  const dom = await cheliped.observe();
  console.log('페이지:', dom.title);
  console.log('링크:', dom.links.length, '| 텍스트:', dom.texts.length, '| 이미지:', dom.images.length);
  console.log('버튼:', dom.buttons.length, '| 입력:', dom.inputs.length);

  console.log('\n=== 텍스트 (최대 20개) ===');
  dom.texts.slice(0, 20).forEach(t => {
    console.log(`  [${t.id}] "${t.text?.substring(0, 100)}"`);
  });

  console.log('\n=== 링크 (최대 15개) ===');
  dom.links.slice(0, 15).forEach(l => {
    console.log(`  [${l.id}] "${l.text?.substring(0, 60)}" → ${l.href}`);
  });

  console.log('\n=== 이미지 (최대 10개) ===');
  dom.images.slice(0, 10).forEach(i => {
    console.log(`  [${i.id}] src=${i.src?.substring(0, 80)}...`);
  });

  // 스크린샷
  const shot = await cheliped.screenshot();
  writeFileSync('instagram-screenshot.png', shot.buffer);
  console.log('\n스크린샷: instagram-screenshot.png');

  // UI Graph
  const graph = await cheliped.observeGraph();
  console.log('\n=== UI Graph ===');
  console.log('Nodes:', graph.nodes.length, '| Edges:', graph.edges.length);

  await cheliped.close();
  console.log('\n완료!');
}

browse().catch(e => { console.error(e); process.exit(1); });
