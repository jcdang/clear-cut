/// <reference lib="webworker" />
//
// ClearCut service worker.
//
// Two responsibilities:
//   1. Cross-origin isolation: rewrap responses with COOP/COEP/CORP so
//      onnxruntime-web can use threaded WASM (SharedArrayBuffer). Replaces
//      the old coi-serviceworker drop-in.
//   2. Offline support: precache the app shell, runtime-cache the imgly
//      model files and Google Fonts. Once the model is cached, the app
//      keeps working with no network.
//
// Written as the SW for vite-plugin-pwa's injectManifest mode, which
// injects self.__WB_MANIFEST at build time.

export {};

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = "clearcut-shell-v1";
const ASSETS_CACHE = "clearcut-assets-v1";
const MODEL_CACHE = "clearcut-models-v1";
const FONT_CACHE = "clearcut-fonts-v1";
const KEEP_CACHES = new Set([
  SHELL_CACHE,
  ASSETS_CACHE,
  MODEL_CACHE,
  FONT_CACHE,
]);

// Workbox replaces this literal at build time. Don't refactor it — the
// injectManifest step does plain text substitution on `self.__WB_MANIFEST`.
// In dev there's no build step, so it stays undefined; coalesce to [].
const MANIFEST =
  (
    self as unknown as {
      __WB_MANIFEST?: Array<{ url: string; revision: string | null }>;
    }
  ).__WB_MANIFEST ?? [];
// Resolve precache URLs against the SW's own scope so they hit the right
// origin/path regardless of where the SW lives (e.g. /clear-cut/).
const PRECACHE_URLS = MANIFEST.map((e) =>
  new URL(e.url, sw.registration.scope).toString(),
);

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Bypass HTTP cache so we always pick up the freshly built revision.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: "reload" })
            .then(async (res) => {
              if (res.ok) await cache.put(url, res);
            })
            .catch(() => {
              // Best-effort: a single missing file shouldn't fail install.
            }),
        ),
      );
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !KEEP_CACHES.has(n)).map((n) => caches.delete(n)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void sw.skipWaiting();
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;

  // Mirror coi-serviceworker: leave only-if-cached cross-origin requests
  // alone or the browser will throw.
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  // Only intercept GETs. Anything else (POST, etc.) goes straight to network.
  if (req.method !== "GET") return;

  event.respondWith(handle(req));
});

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // 1. SPA navigation: network-first, fall back to cached index.html
  //    so deep-link refreshes work offline.
  if (req.mode === "navigate") {
    try {
      const fresh = await fetch(req);
      return withCOI(fresh);
    } catch {
      const fallback = await caches.match(
        new URL("index.html", sw.registration.scope).toString(),
        { cacheName: SHELL_CACHE },
      );
      if (fallback) return withCOI(fallback);
      throw new Error("offline and no cached shell");
    }
  }

  // 2. App shell precache hit (HTML/JS/CSS that vite-plugin-pwa
  //    precached with revision-checked entries).
  if (url.origin === sw.location.origin) {
    const shellHit = await caches.match(req, { cacheName: SHELL_CACHE });
    if (shellHit) return withCOI(shellHit);

    // 3. Same-origin runtime cache — covers the big WASM bundles and
    //    anything else not in the precache. CacheFirst is safe because
    //    Vite hashes filenames, so any change produces a new URL.
    return cacheFirst(req, ASSETS_CACHE);
  }

  // 4. imgly model — CacheFirst.
  if (url.hostname === "staticimgly.com") {
    return cacheFirst(req, MODEL_CACHE);
  }

  // 5. Google Fonts — CacheFirst.
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    return cacheFirst(req, FONT_CACHE);
  }

  // 6. Default: network passthrough with COI rewrap.
  try {
    const res = await fetch(req);
    return withCOI(res);
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return withCOI(cached);
    throw err;
  }
}

// Dedupe in-flight cacheFirst fetches by URL so concurrent callers (e.g.
// imgly's loader hitting resources.json three times in quick succession)
// share one network request instead of racing the cache.put.
const inflight = new Map<string, Promise<Response>>();

async function cacheFirst(req: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return withCOI(cached);

  const key = req.url;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(req);
      // Only cache opaque-or-ok responses; never cache 4xx/5xx.
      if (res.ok || res.type === "opaque") {
        await cache.put(req, res.clone());
      }
      return res;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const shared = await pending;
  return withCOI(shared.clone());
}

// Rewrap with COOP/COEP/CORP so the page is cross-origin-isolated.
// status === 0 means an opaque response with no readable headers; leave it.
function withCOI(res: Response): Response {
  if (res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
