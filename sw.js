/* CodePocket Service Worker
 * - 앱 셸(정적 자산) 선캐시: 설치 후 오프라인 완전 동작
 * - 런타임: 캐시 우선(stale-while-revalidate), 탐색 요청은 오프라인 시 index.html 폴백
 * - 항상 상대 경로 사용 (GitHub Pages 하위 경로 대응)
 */
'use strict';

const CACHE_NAME = 'codepocket-v1';

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

  // 페이지 탐색: 캐시된 index.html 폴백
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

  // 정적 자산: 캐시 우선 + 백그라운드 갱신
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => undefined);
      if (cached) return cached;
      const res = await network;
      if (res) return res;
      return new Response('오프라인', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })()
  );
});
