/* CodePocket Service Worker
 * - 앱 셸(정적 자산) 선캐시: 설치 후 오프라인 완전 동작
 * - HTML/문서: 네트워크 우선(갱신 즉시 반영), 실패 시 캐시 폴백
 * - CSS/JS/아이콘: 네트워크 우선(stale-while-revalidate 유사), 오프라인 시 캐시 폴백
 *   → 디자인/기능 업데이트가 캐시에 갇히지 않도록 함
 * - 항상 상대 경로 사용 (GitHub Pages 하위 경로 대응)
 */
'use strict';

/* 배포 시 디자인/구조 변경마다 VERSION 숫자를 올려 캐시를 강제 갱신 */
const CACHE_NAME = 'codepocket-v4';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/util.js',
  './js/barcodes.js',
  './js/db.js',
  './js/install.js',
  './js/scanner.js',
  './js/generator.js',
  './js/ui.js',
  './js/main.js',
  './vendor/qrcode.min.js',
  './vendor/zxing.umd.min.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 개별 추가로 일부 실패가 전체 설치를 막지 않도록 처리
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 요청은 캐시하지 않음

  // 페이지 탐색: 네트워크 우선, 오프라인 시 index.html 폴백
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        } catch (_) {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('오프라인', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
          );
        }
      })()
    );
    return;
  }

  // 정적 자산: 네트워크 우신 + 실패/오프라인 시 캐시 폴백 (업데이트 즉시 반영)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response('오프라인', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })()
  );
});
