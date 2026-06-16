import { Cheliped } from '../src/index.js';
import { writeFileSync } from 'fs';

async function browse() {
  const cheliped = new Cheliped({ headless: true });
  await cheliped.launch();

  // 1. Hacker News 접속
  console.log('=== Hacker News 접속 ===');
  await cheliped.goto('https://news.ycombinator.com');
  const dom = await cheliped.observe();
  console.log('페이지:', dom.title);
  console.log('링크:', dom.links.length, '| 텍스트:', dom.texts.length);

  console.log('\n상위 뉴스 링크 (최대 15개):');
  // HN의 외부 링크들 (뉴스 제목)
  const newsLinks = dom.links.filter(l => l.href && !l.href.includes('news.ycombinator.com'));
  newsLinks.slice(0, 15).forEach(l => {
    console.log(`  [${l.id}] "${l.text}" → ${l.href}`);
  });

  // 2. UI Graph
  console.log('\n=== UI Graph ===');
  const graph = await cheliped.observeGraph();
  console.log('Nodes:', graph.nodes.length, '| Edges:', graph.edges.length);

  // 3. Semantic Actions
  const actions = await cheliped.actions();
  console.log('\n=== Semantic Actions (최대 5개) ===');
  actions.slice(0, 5).forEach(a => {
    console.log(`  ${a.id} (${a.type}) confidence=${a.confidence}`);
  });

  // 4. 첫 번째 뉴스 클릭
  if (newsLinks.length > 0) {
    const firstNews = newsLinks[0];
    console.log(`\n=== 첫 번째 뉴스 클릭: "${firstNews.text}" ===`);
    await cheliped.click(firstNews.id);
    await new Promise(r => setTimeout(r, 2000));

    const articleDom = await cheliped.observe();
    console.log('이동한 페이지:', articleDom.title);
    console.log('링크:', articleDom.links.length, '| 텍스트:', articleDom.texts.length);

    console.log('\n페이지 주요 텍스트 (최대 5개):');
    articleDom.texts.slice(0, 5).forEach(t => {
      console.log(`  [${t.id}] "${t.text?.substring(0, 100)}"`);
    });

    // 스크린샷
    const shot = await cheliped.screenshot();
    writeFileSync('browse-article.png', shot.buffer);
    console.log('\n기사 스크린샷: browse-article.png');
  }

  // 5. 뒤로가기 → HN 스크린샷
  await cheliped.runJs('history.back()');
  await new Promise(r => setTimeout(r, 1000));
  const hnShot = await cheliped.screenshot();
  writeFileSync('browse-hn.png', hnShot.buffer);
  console.log('HN 스크린샷: browse-hn.png');

  await cheliped.close();
  console.log('\n브라우징 완료!');
}

browse().catch(e => { console.error(e); process.exit(1); });
