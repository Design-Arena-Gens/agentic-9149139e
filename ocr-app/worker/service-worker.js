const LANGUAGE_CACHE = "ocr-language-cache";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(LANGUAGE_CACHE));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/tesseract/")) {
    event.respondWith(
      caches.open(LANGUAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          return cached;
        }

        try {
          const response = await fetch(event.request);
          cache.put(event.request, response.clone());
          return response;
        } catch (error) {
          return new Response("Language data unavailable offline.", {
            status: 503,
            statusText: error instanceof Error ? error.message : undefined,
          });
        }
      }),
    );
  }
});
