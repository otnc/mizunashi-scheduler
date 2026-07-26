/**
 * Service Worker。
 *
 * このサイトは年間データをまとめて取得し、入浴可否の判定は端末側で行う（DESIGN.md §12.6）。
 * つまり年間データさえキャッシュにあれば、オフラインでも「いま入れるか」を
 * 古い答えではなく正しく計算できる。ここでキャッシュするのはその 2 つだけに絞る。
 *
 * ビルド時のプリキャッシュ一覧は作らない。生成物のファイル名に内容ハッシュが付くので、
 * 実行時にキャッシュするだけで新旧の取り違えが起きないため。
 */

const SHELL = 'mizunashi-shell-v1';
const DATA = 'mizunashi-data-v1';
const KEEP = [SHELL, DATA];

const SHELL_ASSETS = [
  '/',
  '/404.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];

/** 年間データ。at=none の静的バリアントなので現在時刻に依存しない */
const DATA_PATH = '/api/v1/years';

function cacheable(response) {
  return response.ok && response.status === 200 && response.type !== 'opaque';
}

async function put(cacheName, request, response) {
  if (!cacheable(response)) return;
  const cache = await self.caches.open(cacheName);
  await cache.put(request, response.clone());
}

/** キャッシュがあれば即返し、裏で更新する */
async function staleWhileRevalidate(event, cacheName) {
  const cache = await self.caches.open(cacheName);
  const cached = await cache.match(event.request);

  const network = self
    .fetch(event.request)
    .then(async (response) => {
      if (cacheable(response)) await cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached != null) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  if (fresh != null) return fresh;
  return new self.Response('offline', { status: 503, statusText: 'Offline' });
}

/** まずネットワーク。落ちていればキャッシュを使う */
async function networkFirst(event, cacheName, fallbackPath) {
  try {
    const response = await self.fetch(event.request);
    event.waitUntil(put(cacheName, event.request, response));
    return response;
  } catch {
    const cache = await self.caches.open(cacheName);
    const cached = await cache.match(event.request);
    if (cached != null) return cached;
    const fallback = fallbackPath == null ? null : await cache.match(fallbackPath);
    if (fallback != null) return fallback;
    return new self.Response('offline', { status: 503, statusText: 'Offline' });
  }
}

/** 内容ハッシュ付きの生成物。名前が変われば別物なので、あれば必ずキャッシュを使う */
async function cacheFirst(event, cacheName) {
  const cache = await self.caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached != null) return cached;
  const response = await self.fetch(event.request);
  event.waitUntil(put(cacheName, event.request, response));
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await self.caches.open(SHELL);
      // 1 つ失敗しても install 全体を落とさない
      await Promise.allSettled(SHELL_ASSETS.map((path) => cache.add(path)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await self.caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => self.caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new self.URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === DATA_PATH || url.pathname.startsWith(`${DATA_PATH}/`)) {
    event.respondWith(staleWhileRevalidate(event, DATA));
    return;
  }

  // 現在時刻に依存する API と原本配信はキャッシュしない
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/archive')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event, SHELL, '/'));
    return;
  }

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(event, SHELL));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, SHELL));
});
