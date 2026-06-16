import { Cheliped } from '../src/index.js';
import { writeFileSync } from 'fs';

async function browse() {
  const cheliped = new Cheliped({ headless: true });
  await cheliped.launch();

  // 1. Instagram 로그인 페이지
  console.log('=== Instagram 로그인 페이지 ===');
  await cheliped.goto('https://www.instagram.com/accounts/login/');
  await new Promise(r => setTimeout(r, 3000));

  let dom = await cheliped.observe();
  console.log('페이지:', dom.title);
  console.log('입력:', dom.inputs.length, '| textarea:', dom.textareas.length, '| 버튼:', dom.buttons.length);

  dom.inputs.forEach(i => console.log(`  input [${i.id}] name=${i.name} type=${i.type} placeholder="${i.placeholder || ''}"`));
  dom.buttons.forEach(b => console.log(`  button [${b.id}] "${b.text}"`));

  // 2. 로그인 정보 입력
  const usernameField = dom.inputs.find(i => i.name === 'username' || i.placeholder?.includes('사용자') || i.placeholder?.includes('username') || i.type === 'text');
  const passwordField = dom.inputs.find(i => i.name === 'password' || i.type === 'password');

  if (usernameField && passwordField) {
    console.log(`\n아이디 입력 [${usernameField.id}]...`);
    await cheliped.fill(usernameField.id, 'tyri.unnie');
    await new Promise(r => setTimeout(r, 500));

    console.log(`비밀번호 입력 [${passwordField.id}]...`);
    await cheliped.fill(passwordField.id, 'Xodud79*i');
    await new Promise(r => setTimeout(r, 500));

    // 로그인 버튼 클릭
    const loginBtn = dom.buttons.find(b => b.text?.includes('로그인') || b.text?.includes('Log in') || b.text?.includes('Log In'));
    if (loginBtn) {
      console.log(`로그인 버튼 클릭 [${loginBtn.id}]...`);
      await cheliped.click(loginBtn.id);
    } else {
      // submit via JS
      console.log('로그인 버튼 못 찾음, form submit...');
      await cheliped.runJs(`document.querySelector('form button[type="submit"]')?.click() || document.querySelector('form')?.submit()`);
    }

    console.log('로그인 대기 중...');
    await new Promise(r => setTimeout(r, 5000));

    // 스크린샷 — 로그인 결과
    const loginShot = await cheliped.screenshot();
    writeFileSync('instagram-login-result.png', loginShot.buffer);
    console.log('로그인 결과 스크린샷: instagram-login-result.png');

    dom = await cheliped.observe();
    console.log('\n로그인 후 페이지:', dom.title);
    console.log('링크:', dom.links.length, '| 텍스트:', dom.texts.length, '| 이미지:', dom.images.length);

    // 3. 프로필 페이지로 이동
    console.log('\n=== 프로필 페이지 이동 ===');
    await cheliped.goto('https://www.instagram.com/tyri.unnie/');
    await new Promise(r => setTimeout(r, 3000));

    dom = await cheliped.observe();
    console.log('페이지:', dom.title);
    console.log('링크:', dom.links.length, '| 텍스트:', dom.texts.length, '| 이미지:', dom.images.length);

    console.log('\n=== 텍스트 (최대 20개) ===');
    dom.texts.slice(0, 20).forEach(t => {
      console.log(`  [${t.id}] "${t.text?.substring(0, 120)}"`);
    });

    console.log('\n=== 이미지 (최대 10개) ===');
    dom.images.slice(0, 10).forEach(i => {
      console.log(`  [${i.id}] src=${i.src?.substring(0, 100)}...`);
    });

    console.log('\n=== 링크 (최대 15개) ===');
    dom.links.slice(0, 15).forEach(l => {
      console.log(`  [${l.id}] "${l.text?.substring(0, 60)}" → ${l.href?.substring(0, 100)}`);
    });

    const shot = await cheliped.screenshot();
    writeFileSync('instagram-profile.png', shot.buffer);
    console.log('\n프로필 스크린샷: instagram-profile.png');
  } else {
    console.log('로그인 필드를 찾지 못했습니다.');
    const shot = await cheliped.screenshot();
    writeFileSync('instagram-debug.png', shot.buffer);
  }

  await cheliped.close();
  console.log('\n완료!');
}

browse().catch(e => { console.error(e); process.exit(1); });
