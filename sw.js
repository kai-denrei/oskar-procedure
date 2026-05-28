// sw.js — hand-authored service worker for oskar-procedure.
//
// Design goals (operator priority: NEVER stale, cache invalidation explicit):
//   - Cache name is keyed to the cache-bust token (bust.sh rewrites CB_TOKEN
//     on every build) so a new build = a new cache bucket. Old buckets are
//     deleted on activate, so the SW can't pin an old build forever.
//   - App code (HTML/JS/CSS) is NetworkFirst: we always try the network first
//     and only fall back to cache when offline. Fresh wins.
//   - Static immutable assets (icons, cb-shapes SVGs, fonts) are CacheFirst.
//   - New versions don't auto-activate (no skipWaiting on install). The page
//     surfaces a consent toast; only on user click do we skipWaiting.
//
// Base-path portable: registered with { scope: './' }, and every precache
// path is RELATIVE to that scope, so it works at localhost root (/) AND under
// GitHub Pages (/oskar-procedure/).

const CB_TOKEN = "dfbbef36";          // bust.sh rewrites this on each build
const CACHE = `oskar-${CB_TOKEN}`;

// App shell — paths relative to the SW scope (repo root). '?v=' tokens are
// intentionally omitted here; for JS/CSS we match with {ignoreSearch:true} so
// a token mismatch still resolves the cached shell when offline.
const PRECACHE = [
  './',                       // navigation root
  './index.html',
  './styles.css',
  './offline.html',
  './manifest.webmanifest',
  './cb-badge.js',
  // ES modules
  './src/main.js',
  './src/tabs.js',
  './src/pwa.js',
  './src/grid.js',
  './src/poisson.js',
  './src/hex.js',
  './src/rng.js',
  './src/vec.js',
  './src/render2d.js',
  './src/controls.js',
  './src/halfedge.js',
  './src/dual.js',
  './src/state.js',
  // M3D-1: WebGL 3D foundation + build-by-stacking
  './src/gl/mat4.js',
  './src/gl/camera.js',
  './src/gl/renderer.js',
  './src/gl/view3d.js',
  './src/structures/heights.js',
  './src/structures/geometry.js',
  // vendored deps (offline)
  './vendor/delaunator.js',
  './vendor/robust-predicates.js',
  // icons (static immutable)
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  // current favicon shape (visual cache-bust badge anchor)
  './cb-shapes/31.svg',
];

// ── install ──────────────────────────────────────────────────────────────
// Precache the shell. Deliberately do NOT skipWaiting() — we wait for the
// user's consent via the toast. addAll is best-effort per item below.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // addAll is atomic (any 404 fails the whole install). Use individual
      // best-effort puts so one missing optional asset can't brick install.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            // Log and continue — a missing optional asset shouldn't block install.
            console.warn('[sw] precache skipped:', url, err && err.message);
          })
        )
      )
    )
  );
});

// Allow the page to trigger activation of a waiting SW (consent toast button).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── activate ─────────────────────────────────────────────────────────────
// Drop every cache that isn't the current token's bucket, enable navigation
// preload, and take control of open clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (name !== CACHE ? caches.delete(name) : null))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

// ── helpers ──────────────────────────────────────────────────────────────

// Wrap a cache put so a failed/opaque/non-200 response never poisons the cache.
async function safePut(request, response) {
  try {
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
  } catch (err) {
    // Swallow — caching is a best-effort optimization, never a hard dependency.
  }
  return response;
}

// NetworkFirst with a timeout. Tries network (or a provided preload response);
// on failure/timeout falls back to the cache (ignoreSearch so ?v= mismatches
// still hit). `fallbackUrl` is a last resort (offline page / shell).
async function networkFirst(request, { timeoutMs = 3000, preload = null, fallbackUrl = null, revalidate = false } = {}) {
  // 1. Try the network (honoring an in-flight navigation-preload response).
  // `revalidate` forces a fresh fetch that bypasses the HTTP cache — used for
  // the HTML entry so a new build's fingerprinted module URLs propagate at once
  // (the entry itself isn't fingerprinted; the modules it imports now are).
  try {
    const netResponse = await (preload
      ? preload
      : fetchWithTimeout(request, timeoutMs, revalidate ? { cache: 'reload' } : undefined));
    if (netResponse) {
      await safePut(request, netResponse);
      return netResponse.clone();
    }
  } catch (err) {
    // fall through to cache
  }

  // 2. Fall back to cache (ignore query string so ?v= token diffs still match).
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  // 3. Last resort fallback (e.g. cached shell / offline page).
  if (fallbackUrl) {
    const fb = await caches.match(fallbackUrl, { ignoreSearch: true });
    if (fb) return fb;
  }

  // 4. Nothing — return a synthetic offline response so fetch() doesn't reject.
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain' },
  });
}

function fetchWithTimeout(request, timeoutMs, init) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), timeoutMs);
    fetch(request, init).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// CacheFirst for immutable static assets. Serve cache, else fetch + populate.
async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    await safePut(request, res);
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// Classify a same-origin GET request by what caching strategy it should use.
function isAppCode(url) {
  return /\.(?:js|mjs|css|webmanifest)$/i.test(url.pathname);
}
function isStaticImmutable(url) {
  // icons, cb-shapes SVGs, fonts
  if (/\/icons\//.test(url.pathname)) return true;
  if (/\/cb-shapes\//.test(url.pathname)) return true;
  return /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/i.test(url.pathname);
}

// ── fetch ────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET. Everything else passes straight through.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: NetworkFirst with ~3s timeout, using navigation preload if
  // present, falling back to cached index.html then offline.html.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const preload = event.preloadResponse
          ? event.preloadResponse.then((r) => r || null).catch(() => null)
          : null;
        const preloadResponse = preload ? await preload : null;
        const res = await networkFirst(request, {
          timeoutMs: 3000,
          preload: preloadResponse ? Promise.resolve(preloadResponse) : null,
          fallbackUrl: './index.html',
          revalidate: true, // bypass HTTP cache on the entry so new module URLs land
        });
        if (res && res.status === 503) {
          // total offline + no cached shell → offline page
          const offline = await caches.match('./offline.html', { ignoreSearch: true });
          if (offline) return offline;
        }
        return res;
      })()
    );
    return;
  }

  // App code (JS/CSS/webmanifest): NetworkFirst, bias to fresh.
  if (isAppCode(url)) {
    event.respondWith(networkFirst(request, { timeoutMs: 3000 }));
    return;
  }

  // Static immutable (icons, cb-shapes SVGs, fonts): CacheFirst.
  if (isStaticImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Anything else same-origin: NetworkFirst as a safe default.
  event.respondWith(networkFirst(request, { timeoutMs: 3000 }));
});
