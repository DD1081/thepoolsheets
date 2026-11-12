// Service Worker: hält die komplette App offline verfügbar.
// Bei jeder Änderung an der App VERSION erhöhen, damit iPads das Update laden.
const VERSION = 'v3';
const CACHE = 'leadsheets-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './logo-word.png',
  './logo-full.png',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs',
  'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitDingbats.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitFixed.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitFixedBold.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitFixedBoldItalic.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitFixedItalic.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitSerif.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitSerifBold.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitSerifBoldItalic.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitSerifItalic.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/FoxitSymbol.pfb',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/LiberationSans-Bold.ttf',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/LiberationSans-BoldItalic.ttf',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/LiberationSans-Italic.ttf',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/standard_fonts/LiberationSans-Regular.ttf'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.startsWith('https://cdn.jsdelivr.net/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
