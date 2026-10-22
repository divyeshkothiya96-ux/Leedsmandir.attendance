// Offline helper for Leeds Mandir Footfall Counts.
// The app's own files load fresh from the internet when it answers within a few seconds, and from this
// phone's copy otherwise, so the app still opens on weak Wi-Fi. Counts and logins are not handled here:
// Firebase keeps those itself.
const CACHE = "footfall-v2";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest",
  "img/toran.svg", "img/lotus.svg", "img/mandala.svg",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
];
const WAIT_MS = 3500;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) =>
    Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("footfall-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req)); return; }
  // Firebase's code files (fixed version numbers) and the Google fonts rarely change: keep a copy.
  if ((url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))
    || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req));
  }
  // Everything else (the database and sign-in) goes straight to the internet.
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const fresh = (req.mode === "navigate" ? fetch(req) : fetch(req, { cache: "no-cache" })).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  try {
    return await Promise.race([fresh, new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), WAIT_MS))]);
  } catch (err) {
    const copy = await cache.match(req, { ignoreSearch: true })
      || (req.mode === "navigate" ? (await cache.match("index.html")) || (await cache.match("./")) : null);
    return copy || fresh;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const copy = await cache.match(req);
  if (copy) return copy;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
  return res;
}
