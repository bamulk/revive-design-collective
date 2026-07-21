// Service worker: web push + offline caching.
//
// Caching strategy (added for field crews in dead zones):
// - Navigations: network-first with a 3.5s cutoff when a cached copy
//   exists — good signal always shows fresh data; bad/no signal falls
//   back to the last-seen copy of the page. Successful page loads are
//   cached; login redirects and errors are not.
// - /_next/static assets: cache-first (content-hashed, immutable).
// - Supabase Storage images (signed thumbs/photos): stale-while-
//   revalidate, capped so the cache can't grow unbounded.
// - APIs, auth, non-GET: never touched.
// - Requests marked x-sw-prefetch (the dashboard's warm-up of today's
//   stages) are fetched + cached like navigations.
//
// Client-side RSC fetches are deliberately NOT intercepted: when they
// fail offline, Next falls back to a full navigation, which the
// navigation handler serves from cache.
//
// Bump CACHE_VERSION to blow away all runtime caches on next activate.

const CACHE_VERSION = "v1";
const PAGES = `shs-pages-${CACHE_VERSION}`;
const STATIC = `shs-static-${CACHE_VERSION}`;
const IMAGES = `shs-images-${CACHE_VERSION}`;
const KNOWN_CACHES = new Set([PAGES, STATIC, IMAGES]);

const NAV_TIMEOUT_MS = 3500;
// Client-router (?_rsc=) fetches get a hard cutoff: in a "bars but no
// data" dead zone they'd otherwise hang forever (fetch never rejects).
// Failing them makes Next fall back to a full navigation, which the
// navigation handler serves from cache.
const RSC_TIMEOUT_MS = 6000;
const IMAGE_CACHE_MAX_ENTRIES = 300;
const PAGE_CACHE_MAX_ENTRIES = 60;
const STATIC_CACHE_MAX_ENTRIES = 300;

self.addEventListener("install", (event) => {
  // Activate immediately so the first install can receive pushes.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("shs-") && !KNOWN_CACHES.has(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// ---------------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------------

function isSupabaseStorage(url) {
  return (
    url.hostname.endsWith(".supabase.co") &&
    (url.pathname.startsWith("/storage/v1/object/") ||
      url.pathname.startsWith("/storage/v1/render/"))
  );
}

function isNeverCachedPath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/portal/login") ||
    pathname.startsWith("/set-password")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  // Supabase Storage images — stale-while-revalidate.
  if (isSupabaseStorage(url)) {
    event.respondWith(staleWhileRevalidate(event, req));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Hashed build assets — cache-first, immutable.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }

  // Page navigations (and our explicit prefetches).
  const isPrefetch = req.headers.get("x-sw-prefetch") === "1";
  if (
    (req.mode === "navigate" || isPrefetch) &&
    !isNeverCachedPath(url.pathname)
  ) {
    event.respondWith(pageNetworkFirst(event, req));
    return;
  }

  // Client-router fetches (?_rsc=): never cached, but given a hard
  // timeout so a stalled dead-zone connection fails fast — Next then
  // falls back to a full navigation, which IS served from cache above.
  if (url.searchParams.has("_rsc") && !isNeverCachedPath(url.pathname)) {
    event.respondWith(fetchWithTimeout(req, RSC_TIMEOUT_MS));
    return;
  }
  // Everything else: straight to the network.
});

async function fetchWithTimeout(req, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(req, { signal: ctrl.signal });
  } catch {
    // A failed Response makes the page's fetch() reject cleanly.
    return Response.error();
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req, { cacheName });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(req, res.clone());
    // Old deploys' hashed chunks pile up forever otherwise.
    trimCache(cache, STATIC_CACHE_MAX_ENTRIES);
  }
  return res;
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(IMAGES);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(req, res.clone());
        trimCache(cache, IMAGE_CACHE_MAX_ENTRIES);
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  return fresh ?? Response.error();
}

async function trimCache(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    // keys() is insertion-ordered — delete the oldest overflow.
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch {
    // Trimming is best-effort.
  }
}

async function pageNetworkFirst(event, req) {
  const cache = await caches.open(PAGES);
  const cached = await cache.match(req.url);

  const doFetch = async () => {
    const res = await fetch(req);
    // Cache only clean, same-origin, non-redirect successes so a
    // logged-out redirect never overwrites a good page copy.
    if (res.ok && !res.redirected && res.type === "basic") {
      await cache.put(req.url, res.clone());
      trimCache(cache, PAGE_CACHE_MAX_ENTRIES);
    }
    return res;
  };

  if (!cached) {
    // No fallback available — let the network take as long as it needs.
    try {
      return await doFetch();
    } catch {
      const home = await cache.match(new URL("/", self.location.origin).href);
      if (home) return home;
      return offlineFallbackResponse();
    }
  }

  // Cached copy available: race the network against a cutoff. If the
  // network is slow we serve the cached page immediately and let the
  // fetch finish in the background to refresh the cache.
  return await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(cached);
      }
    }, NAV_TIMEOUT_MS);

    const fetching = doFetch()
      .then((res) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(cached);
        }
      });
    // Keep the SW alive until the background refresh completes.
    event.waitUntil(fetching);
  });
}

function offlineFallbackResponse() {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; background:#f8fafc; color:#0f172a;">
  <div style="text-align:center; padding:24px;">
    <div style="font-size:40px;">&#128225;</div>
    <h1 style="font-size:18px; margin:12px 0 6px;">You're offline</h1>
    <p style="font-size:14px; color:#475569; max-width:280px;">This page isn't saved for offline use yet. Pages you've visited recently open without service.</p>
    <button onclick="location.reload()" style="margin-top:14px; padding:10px 18px; border-radius:8px; border:0; background:#0f172a; color:#fff; font-weight:600;">Try again</button>
  </div>
</body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// ---------------------------------------------------------------------
// Web push (unchanged)
// ---------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = { title: "Revive Design Collective", body: "", url: "/" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      // Plain-text fallback
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url ?? "/" },
      tag: data.tag,
    }),
  );
});

// Open / focus the app when the user taps a notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if ("focus" in c) {
            c.navigate(targetUrl);
            return c.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      }),
  );
});
