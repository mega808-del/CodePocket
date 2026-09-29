// CodePocket 헤드리스 브라우저 스모크 테스트
// 실행: node test/smoke.browser.js
// 최초 실행 시 puppeteer-core를 test/.deps에 자동 설치합니다 (프로젝트 의존성에 추가되지 않음).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEPS_DIR = path.join(__dirname, '.deps');

function ensureDeps() {
  if (fs.existsSync(path.join(DEPS_DIR, 'node_modules', 'puppeteer-core'))) return;
  console.log('puppeteer-core 설치 중... (최초 1회)');
  fs.mkdirSync(DEPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEPS_DIR, 'package.json'), JSON.stringify({ name: 'cp-test-deps', private: true }));
  // Windows에서는 npm.cmd로 실행해야 함
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['install', 'puppeteer-core@23', '--silent', '--no-audit', '--no-fund'], {
    cwd: DEPS_DIR, stdio: 'inherit', shell: process.platform === 'win32'
  });
}
ensureDeps();

const http = require('http');
const puppeteer = require(path.join(DEPS_DIR, 'node_modules', 'puppeteer-core'));

const ROOT = path.join(__dirname, '..');
const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const EXECUTABLE = fs.existsSync(CHROME_PATHS[0]) ? CHROME_PATHS[0]
  : fs.existsSync(CHROME_PATHS[1]) ? CHROME_PATHS[1]
  : fs.existsSync(CHROME_PATHS[2]) ? CHROME_PATHS[2]
  : CHROME_PATHS[3];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json'
};

function startServer(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS ', name); }
  else { failed++; console.error('FAIL ', name, extra || ''); }
}

(async () => {
  const srv = await startServer(8931);
  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE,
    headless: 'new',
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // 1) 앱 부팅
  await page.goto('http://127.0.0.1:8931/index.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view-home', { timeout: 5000 });
  check('부팅: 홈 화면 렌더', true);
  check('설치 버튼 존재', await page.$eval('#btn-install', (el) => el.textContent.includes('앱설치')));
  check('하단 중복 버튼 없음', (await page.$('#btn-add')) === null);
  check('상단 추가 버튼 존재', (await page.$('#btn-add-hero')) !== null);
  check('CodePocket 타이틀', (await page.title()).includes('CodePocket'));

  // 2) 빈 상태 표시
  await page.waitForFunction(() => !document.getElementById('empty-state').classList.contains('hidden'), { timeout: 3000 })
    .then(() => check('빈 상태 안내 표시', true))
    .catch(() => check('빈 상태 안내 표시', false));

  // 3) 코드 추가 (직접 입력 - QR)
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open', { timeout: 3000 });
  check('에디터 열림', true);

  await page.type('#inp-name', '우리집 주차장');
  await page.type('#inp-value', 'PARKING-B2-3391');
  await page.click('#type-seg button[data-type="qr"]');
  await page.click('#btn-save');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 1, { timeout: 3000 });
  check('코드 저장 후 카드 1개', true);
  // 카드 썸네일(비동기 QR 생성)이 실제 이미지로 교체될 때까지 대기
  await page.waitForFunction(() => !!document.querySelector('.code-card .thumb img'), { timeout: 5000 })
    .then(() => check('카드에 실제 QR 미리보기 표시', true))
    .catch(() => check('카드에 실제 QR 미리보기 표시', false));
  const cardText = await page.$eval('.code-card', (el) => el.textContent);
  check('카드에 이름 표시', cardText.includes('우리집 주차장'));

  // 4) 뷰어: 카드 클릭 -> QR 재생성 캔버스 확인
  await page.click('.code-card');
  await page.waitForSelector('#view-viewer.open', { timeout: 3000 });
  await page.waitForFunction(() => {
    const c = document.getElementById('viewer-canvas');
    return c.width > 100 && c.height > 100;
  }, { timeout: 3000 });
  check('뷰어 QR 캔버스 생성', true);
  check('뷰어 이름 표시', (await page.$eval('#viewer-name-text', (el) => el.textContent)).includes('우리집 주차장'));

  // 밝기 버튼 토글 (비동기 핸들러 완료 대기)
  await page.click('#btn-brightness');
  await page.waitForFunction(() => document.getElementById('btn-brightness').classList.contains('active'), { timeout: 3000 })
    .then(() => check('밝기 모드 토글', true))
    .catch(() => check('밝기 모드 토글', false));

  // 뷰어 닫기
  await page.click('#view-viewer [data-close]');
  await page.waitForFunction(() => !document.getElementById('view-viewer').classList.contains('open'));

  // 5) 즐겨찾기
  await page.click('.code-card .icon-btn');
  await page.waitForFunction(() => document.querySelector('.code-card .name .star') !== null, { timeout: 3000 })
    .then(() => check('즐겨찾기 별 표시', true))
    .catch(() => check('즐겨찾기 별 표시', false));

  // 6) 검색: 매칭 안 되는 텍스트 -> 빈 목록
  await page.type('#search-input', '병원없음');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 0, { timeout: 3000 });
  check('검색 필터(결과 없음)', true);
  await page.click('#search-input', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 1);

  // 7) 두 번째 코드 (바코드 - EAN) 추가 후 카테고리 필터
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open');
  await page.type('#inp-name', '헬스장 락커');
  await page.select('#inp-category', 'gym');
  await page.type('#inp-value', '12345678');
  await page.click('#type-seg button[data-type="barcode"]');
  // 미리보기 갱신 대기
  await page.evaluate(() => document.getElementById('inp-value').dispatchEvent(new Event('change')));
  await page.waitForFunction(() => !document.getElementById('preview-canvas').classList.contains('hidden'), { timeout: 3000 })
    .then(() => check('바코드 미리보기 생성', true))
    .catch(() => check('바코드 미리보기 생성', false));
  await page.click('#btn-save');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 2, { timeout: 3000 });
  check('두 번째 코드 저장', true);

  // 카테고리 칩: 헬스장만
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip')];
    chips.find((c) => c.textContent.includes('헬스장')).click();
  });
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 1, { timeout: 3000 });
  check('카테고리 필터(헬스장 1개)', true);
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip')];
    chips.find((c) => c.textContent.includes('전체')).click();
  });
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 2);

  // 8) 수정 흐름
  await page.click('.code-card'); // 첫 번째(즐겨찾기=주차장) 카드
  await page.waitForSelector('#view-viewer.open');
  await page.click('#btn-edit');
  await page.waitForSelector('#view-editor.open');
  const nameVal = await page.$eval('#inp-name', (el) => el.value);
  check('수정 화면 기존 값 로드', nameVal.includes('우리집 주차장'));
  await page.$eval('#inp-name', (el) => { el.value = ''; });
  await page.type('#inp-name', '회사 주차장');
  await page.click('#btn-save');
  await page.waitForFunction(() => [...document.querySelectorAll('.code-card')].some((c) => c.textContent.includes('회사 주차장')), { timeout: 3000 });
  check('수정 저장 반영', true);

  // 9) 삭제 흐름 (길게 누르기 대신 DB 직접 삭제로 로직 검증)
  const delResult = await page.evaluate(async () => {
    const codes = await window.CodePocket.DB.listCodes();
    const target = codes.find((c) => c.name === '헬스장 락커');
    await window.CodePocket.DB.deleteCode(target.id);
    return (await window.CodePocket.DB.listCodes()).length;
  });
  check('삭제 후 1개 남음', delResult === 1);

  // 10) 내보내기 JSON 구조 검증
  const exported = await page.evaluate(async () => {
    const json = await window.CodePocket.DB.exportJson();
    return json;
  });
  check('내보내기 구조', exported.app === 'CodePocket' && Array.isArray(exported.codes) && exported.codes.length === 1);

  // 11) 가져오기 (병합)
  const importCount = await page.evaluate(async () => {
    const payload = {
      app: 'CodePocket', schema: 1,
      codes: [{ id: 'imported_1', name: '병원 접수증', value: 'HOSP-2026-0928', type: 'qr', category: 'hospital' }]
    };
    return window.CodePocket.DB.importJson(payload);
  });
  check('가져오기 1개', importCount === 1);
  await page.evaluate(() => window.CodePocket.UI.reload());
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 2);

  // 12) 새로고침 후 데이터 유지 (IndexedDB 영속성)
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length >= 1, { timeout: 5000 });
  const afterReload = await page.$$eval('.code-card', (els) => els.length);
  check('새로고침 후 데이터 유지', afterReload === 2, `실제: ${afterReload}`);

  // 12b) 가져온 병원 접수증 삭제 (13번 자동 이름 테스트를 위해 상태 정리)
  await page.evaluate(async () => {
    const codes = await window.CodePocket.DB.listCodes();
    const target = codes.find((c) => c.name === '병원 접수증');
    if (target) await window.CodePocket.DB.deleteCode(target.id);
  });
  await page.evaluate(() => window.CodePocket.UI.reload());
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 1, { timeout: 3000 });

  // 13) 이름 없이 저장 -> 자동 이름 생성 (카테고리 병원 지정)
  // 저장 버튼은 스티커 액션바로 항상 보이므로 스크롤 없이 클릭 가능
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open');
  await page.type('#inp-value', 'PARKING-C1-777');
  await page.select('#inp-category', 'hospital');
  await page.click('#btn-save');
  await page.waitForFunction(() => [...document.querySelectorAll('.code-card .name')].some((el) => /병원 QR( 2)?$/.test(el.textContent.trim())), { timeout: 3000 })
    .then(() => check('이름 없이 저장: 자동 이름 생성', true))
    .catch(() => check('이름 없이 저장: 자동 이름 생성', false));

  // 14) 카테고리 순서 편집: 기타를 맨 위로
  await page.click('#chip-order-btn');
  await page.waitForFunction(() => document.getElementById('chip-row').classList.contains('editing'));
  // "기타" 칩의 ▲를 (기타가 마지막이므로) 4번 눌러 맨 위로
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip')];
    const other = chips.find((c) => c.textContent.includes('기타'));
    const up = other.querySelector('.order-btns button');
    for (let i = 0; i < 5; i++) up.click();
  });
  await page.click('#chip-order-btn'); // 편집 완료
  // '전체' 칩은 항상 첫 번째(고정), 그 다음 칩이 이동된 '기타'여야 함
  const firstTwoChips = await page.$$eval('.chip', (els) => els.slice(0, 2).map((el) => el.textContent));
  check('카테고리 순서 이동: 전체 다음 기타가 맨 위', firstTwoChips[0].includes('전체') && firstTwoChips[1].includes('기타'), firstTwoChips.join(' | '));

  // 14b) 사용자 정의 카테고리 추가/삭제 (입력란 + 아이콘 선택)
  await page.evaluate(() => document.getElementById('chip-row').querySelector('.chip-add').click());
  await page.waitForSelector('#cat-modal:not(.hidden)', { timeout: 3000 });
  check('카테고리 추가 모달 열림', true);
  await page.type('#cat-label-input', '학원');
  // 아이콘 6번째(🎓) 선택
  await page.evaluate(() => document.querySelectorAll('#cat-emoji-row .emoji-opt')[5].click());
  await page.click('#cat-submit');
  await page.waitForFunction(() => document.getElementById('cat-modal').classList.contains('hidden'), { timeout: 3000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.chip')].some((c) => c.textContent.includes('학원')), { timeout: 3000 })
    .then(() => check('사용자 정의 카테고리(학원) 칩 추가', true))
    .catch(() => check('사용자 정의 카테고리(학원) 칩 추가', false));

  // 에디터 셀렉트에도 반영되는지
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open');
  const catOpts = await page.$eval('#inp-category', (el) => [...el.options].map((o) => o.value));
  check('에디터 카테고리 셀렉트에 사용자 정의 반영', catOpts.some((v) => v.startsWith('u_')));
  await page.click('#view-editor [data-close]');

  // 편집 모드에서 ✕ 삭제
  await page.click('#chip-order-btn');
  await page.waitForFunction(() => document.getElementById('chip-row').classList.contains('editing'));
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip')];
    const target = chips.find((c) => c.textContent.includes('학원'));
    target.querySelector('.chip-del').click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#modal-buttons .btn')].some((b) => b.textContent === '삭제'), { timeout: 3000 });
  await page.evaluate(() => {
    const del = [...document.querySelectorAll('#modal-buttons .btn')].find((b) => b.textContent === '삭제');
    del.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('.chip')].some((c) => c.textContent.includes('학원')), { timeout: 3000 })
    .then(() => check('사용자 정의 카테고리 삭제', true))
    .catch(() => check('사용자 정의 카테고리 삭제', false));
  await page.click('#chip-order-btn'); // 편집 모드 종료

  // 15) 모바일 뷰포트에서 가로 넘침 없음 확인 (기타 글자 잘림 문제 재발 방지)
  const overflow = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.chip')];
    const other = chips.find((c) => c.textContent.includes('기타'));
    const r = other.getBoundingClientRect();
    const visible = r.right <= window.innerWidth && r.width > 0;
    return { visible, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check('기타 칩 화면 안에 완전히 보임', overflow.visible);
  check('문서 가로 스크롤 없음', !overflow.docOverflow);

  // 16) 콘솔/페이지 오류 수집 (리소스 404 등 제외, 심각 오류만 판정)
  const serious = pageErrors.filter((e) => !/ResizeObserver/.test(e));
  check('페이지 스크립트 오류 없음', serious.length === 0, serious.join(' | '));
  const realConsoleErrors = consoleErrors.filter((t) => !/Failed to load resource|net::ERR/.test(t));
  check('콘솔 오류 없음', realConsoleErrors.length === 0, realConsoleErrors.join(' | '));

  await browser.close();
  srv.close();
  console.log(failed ? `\n스모크 실패: ${failed}건` : '\n스모크 테스트 전체 통과');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('스모크 테스트 실행 오류:', e);
  process.exit(1);
});
