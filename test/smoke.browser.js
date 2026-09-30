// CodePocket 헤드리스 브라우저 스모크 테스트 (이름 기반 카드 + ⋮ 메뉴)
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

  // 카드의 ⋮ 메뉴 열기 / 메뉴 항목 클릭 헬퍼
  const openMenuFor = (namePart) => page.evaluate((part) => {
    const card = [...document.querySelectorAll('.code-card')].find((c) => c.textContent.includes(part));
    if (!card) throw new Error('카드 없음: ' + part);
    card.querySelector('.menu-btn').click();
  }, namePart);
  const clickMenuItem = (label) => page.evaluate((lbl) => {
    const item = [...document.querySelectorAll('#menu-items .menu-item')].find((b) => b.textContent.includes(lbl));
    if (!item) throw new Error('메뉴 항목 없음: ' + lbl);
    item.click();
  }, label);
  const modalButtonClick = (label) => page.evaluate((lbl) => {
    const btn = [...document.querySelectorAll('#modal-buttons .btn')].find((b) => b.textContent === lbl);
    if (!btn) throw new Error('모달 버튼 없음: ' + lbl);
    btn.click();
  }, label);

  // 1) 앱 부팅
  await page.goto('http://127.0.0.1:8931/index.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#view-home', { timeout: 5000 });
  check('부팅: 홈 화면 렌더', true);
  check('설치 버튼 존재', await page.$eval('#btn-install', (el) => el.textContent.includes('앱설치')));
  check('하단 중복 버튼 없음', (await page.$('#btn-add')) === null);
  check('상단 추가 버튼 존재', (await page.$('#btn-add-hero')) !== null);
  check('CodePocket 타이틀', (await page.title()).includes('CodePocket'));
  check('카테고리 칩 UI 제거됨', (await page.$('#chip-row')) === null && (await page.$('#inp-category')) === null);

  // 2) 빈 상태 표시
  await page.waitForFunction(() => !document.getElementById('empty-state').classList.contains('hidden'), { timeout: 3000 })
    .then(() => check('빈 상태 안내 표시', true))
    .catch(() => check('빈 상태 안내 표시', false));

  // 2b) 에디터: 이름 입력 칸이 촬영/갤러리 버튼 바로 아래에 있는지
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open', { timeout: 3000 });
  const nameRightAfterPhoto = await page.evaluate(() => {
    const photo = document.querySelector('#view-editor .photo-actions');
    return photo.nextElementSibling !== null &&
      photo.nextElementSibling.querySelector('#inp-name') !== null;
  });
  check('이름 입력 칸이 촬영/갤러리 버튼 바로 아래', nameRightAfterPhoto);
  await page.click('#view-editor [data-close]');

  // 3) 코드 추가 (직접 입력 - QR): 사용자 입력 이름이 그대로 버튼이 되는지
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
  check('카드에 입력한 이름 표시', cardText.includes('우리집 주차장'));
  check('카드에 QR CODE 태그 표시', /QR\s*CODE/.test(cardText), cardText);
  // 이름이 파란색 3D 버튼 스타일인지 (블루 그라데이션 + 흰 글씨)
  const nameStyle = await page.$eval('.code-card .name', (el) => {
    const s = getComputedStyle(el);
    return { bgImage: s.backgroundImage, color: s.color, radius: s.borderRadius, shadow: s.boxShadow };
  });
  check('이름이 파란 그라데이션 버튼', /gradient/.test(nameStyle.bgImage) && /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/.test(nameStyle.color), JSON.stringify(nameStyle));
  check('이름 버튼에 입체 그림자', nameStyle.shadow !== 'none' && nameStyle.radius !== '0px', nameStyle.radius);

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

  // 5) ⋮ 메뉴 구성 + 즐겨찾기
  await openMenuFor('우리집 주차장');
  const menuTexts = await page.$$eval('#menu-items .menu-item', (els) => els.map((e) => e.textContent));
  check('메뉴에 이름 수정 있음', menuTexts.some((t) => t.includes('이름 수정')));
  check('메뉴에 코드 수정 있음', menuTexts.some((t) => t.includes('코드 수정')));
  check('메뉴에 즐겨찾기 있음', menuTexts.some((t) => t.includes('즐겨찾기')));
  check('메뉴에 크게 보기 있음', menuTexts.some((t) => t.includes('크게 보기')));
  check('메뉴에 삭제 있음', menuTexts.some((t) => t.includes('삭제')));

  await clickMenuItem('즐겨찾기');
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

  // 7) 두 번째 코드 (바코드) 추가 + 최근 등록이 맨 위
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open');
  await page.type('#inp-name', '헬스장 락커');
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
  const firstName = await page.$eval('.code-card .name', (el) => el.textContent);
  check('최근 등록 코드가 목록 맨 위', firstName.includes('헬스장 락커'), firstName);
  const firstKind = await page.$eval('.code-card .kind', (el) => el.textContent);
  check('바코드 카드에 BARCODE 태그', /BARCODE/.test(firstKind), firstKind);

  // 8) 세 번째 코드 추가 후 이름 검색 ("병원" -> 병원 출입카드만)
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open');
  await page.type('#inp-name', '병원 출입카드');
  await page.type('#inp-value', 'HOSP-2026-0928');
  await page.click('#btn-save');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 3, { timeout: 3000 });
  await page.type('#search-input', '병원');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 1, { timeout: 3000 });
  const searched = await page.$eval('.code-card', (el) => el.textContent);
  check('이름 검색: "병원" -> 병원 출입카드', searched.includes('병원 출입카드'), searched);
  await page.click('#search-input', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 3);

  // 9) 이름 수정: ⋮ → 이름 수정 → 즉시 반영 + 긴 이름 2줄 처리
  await openMenuFor('병원 출입카드');
  await clickMenuItem('이름 수정');
  await page.waitForSelector('#rename-modal:not(.hidden)', { timeout: 3000 });
  const renameLoaded = await page.$eval('#rename-input', (el) => el.value);
  check('이름 수정 모달 기존 값 로드', renameLoaded === '병원 출입카드', renameLoaded);
  await page.$eval('#rename-input', (el) => { el.value = ''; });
  await page.type('#rename-input', '서울대학교병원 본관 출입 QR');
  await page.click('#rename-submit');
  await page.waitForFunction(() => [...document.querySelectorAll('.code-card .name')].some((el) => el.textContent.includes('서울대학교병원 본관 출입 QR')), { timeout: 3000 })
    .then(() => check('이름 수정 즉시 반영', true))
    .catch(() => check('이름 수정 즉시 반영', false));

  // 긴 이름이 화면 밖으로 밀려나지 않는지 (2줄 클램프)
  const overflow = await page.evaluate(() => {
    const name = [...document.querySelectorAll('.code-card .name')].find((el) => el.textContent.includes('서울대학교병원'));
    const r = name.getBoundingClientRect();
    return {
      within: r.right <= window.innerWidth + 1 && r.width > 0,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      clamped: name.scrollHeight <= name.clientHeight + 2
    };
  });
  check('긴 이름이 화면 안에 완전히 보임', overflow.within);
  check('문서 가로 스크롤 없음', !overflow.docOverflow);

  // 10) 코드 수정 흐름 (뷰어 → 수정)
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.code-card')].find((c) => c.textContent.includes('우리집 주차장'));
    card.click();
  });
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

  // 11) 삭제 흐름: ⋮ → 삭제 → 확인창("삭제하시겠습니까?") → 삭제
  await openMenuFor('헬스장 락커');
  await clickMenuItem('삭제');
  await page.waitForFunction(() => !document.getElementById('modal').classList.contains('hidden'), { timeout: 3000 });
  const confirmMsg = await page.$eval('#modal-msg', (el) => el.textContent);
  check('삭제 확인창에 코드 이름 표시', confirmMsg.includes('헬스장 락커') && confirmMsg.includes('삭제하시겠습니까'), confirmMsg);
  await modalButtonClick('취소');
  await page.waitForFunction(() => document.getElementById('modal').classList.contains('hidden'));
  check('취소 시 삭제 안 됨', (await page.$$eval('.code-card', (els) => els.length)) === 3);
  await openMenuFor('헬스장 락커');
  await clickMenuItem('삭제');
  await page.waitForFunction(() => !document.getElementById('modal').classList.contains('hidden'), { timeout: 3000 });
  await modalButtonClick('삭제');
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 2, { timeout: 3000 });
  const remainTexts = await page.$$eval('.code-card', (els) => els.map((e) => e.textContent));
  check('해당 코드만 삭제됨', !remainTexts.some((t) => t.includes('헬스장 락커')) && remainTexts.some((t) => t.includes('회사 주차장')));

  // 12) 내보내기 JSON 구조 검증
  const exported = await page.evaluate(async () => {
    const json = await window.CodePocket.DB.exportJson();
    return json;
  });
  check('내보내기 구조', exported.app === 'CodePocket' && Array.isArray(exported.codes) && exported.codes.length === 2);

  // 13) 가져오기 (병합) - 기존 데이터 유지 확인
  const importCount = await page.evaluate(async () => {
    const payload = {
      app: 'CodePocket', schema: 1,
      codes: [{ id: 'imported_1', name: '병원 접수증', value: 'HOSP-2026-0928-2', type: 'qr' }]
    };
    return window.CodePocket.DB.importJson(payload);
  });
  check('가져오기 1개', importCount === 1);
  await page.evaluate(() => window.CodePocket.UI.reload());
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 3);

  // 14) 새로고침 후 데이터 유지 (IndexedDB 영속성)
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length >= 1, { timeout: 5000 });
  const afterReload = await page.$$eval('.code-card', (els) => els.length);
  check('새로고침 후 데이터 유지', afterReload === 3, `실제: ${afterReload}`);

  // 14b) 가져온 병원 접수증 삭제 (자동 이름 테스트를 위해 상태 정리)
  await page.evaluate(async () => {
    const codes = await window.CodePocket.DB.listCodes();
    const target = codes.find((c) => c.name === '병원 접수증');
    if (target) await window.CodePocket.DB.deleteCode(target.id);
  });
  await page.evaluate(() => window.CodePocket.UI.reload());
  await page.waitForFunction(() => document.querySelectorAll('.code-card').length === 2, { timeout: 3000 });

  // 15) 이름 없이 저장 -> 자동 이름 생성 (예: "QR 코드")
  await page.click('#btn-add-hero');
  await page.waitForSelector('#view-editor.open');
  await page.type('#inp-value', 'PARKING-C1-777');
  await page.click('#btn-save');
  await page.waitForFunction(() => [...document.querySelectorAll('.code-card .name')].some((el) => /QR 코드( 2)?$/.test(el.textContent.trim())), { timeout: 3000 })
    .then(() => check('이름 없이 저장: 자동 이름 생성', true))
    .catch(() => check('이름 없이 저장: 자동 이름 생성', false));

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
