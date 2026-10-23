/* Service Worker：快取網頁外殼，讓 APP 可安裝並快速開啟；氣象資料一律即時向網路取得 */
const CACHE = 'klwsdemo-v1.0.1';
const SHELL = [
  './', './index.html', './admin.html', './css/style.css', './css/admin.css',
  './js/core.js', './js/data.js', './js/report.js', './js/app.js', './js/admin.js',
  './manifest.webmanifest', './icons/logo.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 外部 API 不經快取
  if (url.pathname.endsWith('/data/config.json')) return; // 設定檔永遠取最新
  // 網頁外殼：網路優先，離線時改用快取
  e.respondWith(
    fetch(e.request, e.request.mode === 'navigate' ? undefined : { cache: 'no-cache' }).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
