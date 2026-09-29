// CodePocket PWA 설치 가능성 검증 (Chrome 설치 기준)
// 실행: node test/install.test.js
// Chrome이 beforeinstallprompt를 발생시키기 위한 핵심 조건을 검사한다:
//   1) manifest 연결 + 유효성 (name, start_url, scope, display, 아이콘 192/512 any+maskable)
//   2) Service Worker 등록 성공 + fetch 핸들러 보유
//   3) manifest/SW/아이콘 등 필수 리소스 200 응답
//   4) 보안 컨텍스트(localhost/https) 여부
// 주의: 헤드리스 Chrome은 실제 설치 프롬프트가 뜨지 않으므로 이벤트 자체는 검사하지 않는다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require(path.join(__dirname, '.deps', 'node_modules', 'puppeteer-core'));

const ROOT = path.join(__dirname, '..');
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
  if (cond) console.log('PASS ', name);
  else { failed++; console.error('FAIL ', name, extra || ''); }
}

(async () => {
  const srv = await startServer(8937);
  const browser = await puppeteer.launch({
    executablePath:
      fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8937/index.html', { waitUntil: 'networkidle0' });

  // 0) 앱설치 버튼이 화면에 보이는지 (과거 숨김 플래그 무관하게 항상 표시)
  const chipVisible = await page.evaluate(() => {
    const chip = document.getElementById('btn-install');
    if (!chip) return { exists: false };
    const r = chip.getBoundingClientRect();
    const style = getComputedStyle(chip);
    return {
      exists: true,
      hidden: chip.classList.contains('hidden') || style.display === 'none',
      text: chip.textContent.trim(),
      right: r.right,
      width: r.width,
      inViewport: r.top >= 0 && r.right <= window.innerWidth + 1 && r.width > 0
    };
  });
  check('앱설치 버튼 존재', chipVisible.exists === true);
  check('앱설치 버튼 화면에 표시', chipVisible.exists && !chipVisible.hidden, JSON.stringify(chipVisible));
  check('앱설치 버튼 텍스트', chipVisible.text === '앱설치', chipVisible.text);
  check('앱설치 버튼 헤더 우측 배치', chipVisible.inViewport && chipVisible.right > 195, JSON.stringify(chipVisible));

  // 1) 보안 컨텍스트
  const secure = await page.evaluate(() => window.isSecureContext);
  check('보안 컨텍스트(localhost)', secure === true);

  // 2) manifest 연결 + 내용 검증
  const manifestHref = await page.$eval('link[rel="manifest"]', (el) => el.getAttribute('href'));
  check('manifest 링크 존재', !!manifestHref);
  const manifest = await page.evaluate(async (href) => {
    const res = await fetch(href);
    return { status: res.status, type: res.headers.get('content-type'), json: await res.json() };
  }, manifestHref);
  check('manifest 200 응답', manifest.status === 200, `status=${manifest.status}`);
  const m = manifest.json;
  check('manifest name/short_name', !!(m.name && m.short_name));
  check('manifest start_url/scope', !!(m.start_url && m.scope));
  check('manifest display standalone', m.display === 'standalone');
  const anyIcons = (m.icons || []).filter((i) => (i.purpose || 'any').includes('any'));
  const maskableIcons = (m.icons || []).filter((i) => (i.purpose || '').includes('maskable'));
  check('아이콘 192+512 (any)', anyIcons.some((i) => i.sizes.includes('192')) && anyIcons.some((i) => i.sizes.includes('512')));
  check('아이콘 maskable 존재', maskableIcons.length > 0);

  // 3) 아이콘 파일 실제 로드 + PNG 크기 확인
  const iconResults = await page.evaluate(async (manifestJson) => {
    const out = [];
    for (const icon of manifestJson.icons || []) {
      try {
        const res = await fetch(icon.src);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        out.push({ src: icon.src, status: res.status, w: bmp.width, h: bmp.height });
        bmp.close && bmp.close();
      } catch (e) {
        out.push({ src: icon.src, error: String(e) });
      }
    }
    return out;
  }, m);
  for (const r of iconResults) {
    const expected = parseInt((r.src.match(/-(\d+)\.png$/) || [])[1] || '0', 10);
    check(`아이콘 로드 ${r.src}`, r.status === 200 && r.w === expected && r.h === expected,
      r.error || `status=${r.status} ${r.w}x${r.h} (기대 ${expected})`);
  }

  // 4) Service Worker 등록 + fetch 핸들러
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { registered: false };
    await navigator.serviceWorker.ready;
    return { registered: true, active: !!reg.active, scope: reg.scope };
  });
  check('Service Worker 등록', swState.registered === true, JSON.stringify(swState));
  check('Service Worker 활성화', swState.active === true);
  // fetch 핸들러 보유: 캐시에 리소스가 채워졌는지로 간접 확인
  await new Promise((r) => setTimeout(r, 800));
  const swFetch = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    if (!cacheNames.length) return { hasCache: false };
    const cache = await caches.open(cacheNames[0]);
    const keys = await cache.keys();
    return { hasCache: keys.length > 0, count: keys.length, cacheName: cacheNames[0] };
  });
  check('SW 선캐시 동작(fetch 핸들러)', swFetch.hasCache === true, JSON.stringify(swFetch));

  // 5) 과거 숨김 플래그가 있어도 버튼이 보여야 함 (회귀 방지)
  await page.evaluate(() => { localStorage.setItem('cp_install_dismissed', '1'); });
  await page.reload({ waitUntil: 'networkidle0' });
  const chipAfterFlag = await page.evaluate(() => {
    const chip = document.getElementById('btn-install');
    return chip && !chip.classList.contains('hidden') && getComputedStyle(chip).display !== 'none';
  });
  check('숨김 플래그 있어도 버튼 표시', chipAfterFlag === true);
  await page.evaluate(() => localStorage.removeItem('cp_install_dismissed'));

  // 6) 테마색 일관성 (설치 배너/스플래시 품질)
  const themeColor = await page.$eval('meta[name="theme-color"]', (el) => el.getAttribute('content'));
  check('theme-color = manifest theme_color', themeColor === m.theme_color, `meta=${themeColor} manifest=${m.theme_color}`);

  await browser.close();
  srv.close();
  console.log(failed ? `\n설치 가능성 검증 실패: ${failed}건` : '\nPWA 설치 조건 모두 충족 ✅ (Chrome 설치 배너 조건)');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('설치 검증 실행 오류:', e);
  process.exit(1);
});
