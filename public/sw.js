const CACHE_PREFIX = "explore-pwa-";
const CACHE_NAME = "explore-pwa-v2";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => new Response(
        "<!doctype html><html><body><main><h1>Explore is offline</h1><p>Reconnect to load your cloud journal safely.</p></main></body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      )),
    );
    return;
  }

  // Never pin Next.js application code in the service-worker cache. Hashed
  // scripts and styles use normal HTTP caching and must follow fresh HTML.
  if (["script", "style"].includes(request.destination)) return;

  if (["image", "font"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
