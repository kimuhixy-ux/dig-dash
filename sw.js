// キャッシュ名のバージョンは、コードやデータを更新したら必ず上げる。上げ忘れると端末に古い版が残る。
const CACHE = 'dig-dash-cache-v5';
const ASSETS = [
  './', 'index.html', 'manifest.json', 'css/style.css', 'data/levels.json',
  'js/main.js', 'js/game.js', 'js/render.js', 'js/input.js', 'js/audio.js',
  'js/storage.js', 'js/play.js', 'js/editor.js', 'js/tutorial.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// HTMLとJSONは最新を優先(network-first)、それ以外はキャッシュ優先(cache-first)。
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isDoc = req.mode === 'navigate' || /\.(html|json)$/.test(new URL(req.url).pathname);
  ev.respondWith(isDoc ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || cache.match('index.html');
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}
