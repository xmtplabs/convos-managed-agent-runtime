/* Minimal service worker for Convos landing PWA – fetch-through. */
self.addEventListener("fetch", function (event) {
  event.respondWith(fetch(event.request));
});
