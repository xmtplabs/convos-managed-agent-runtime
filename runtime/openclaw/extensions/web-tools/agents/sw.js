/* Minimal service worker for agents PWA – fetch-through. */
self.addEventListener("fetch", function (event) {
  event.respondWith(fetch(event.request));
});
