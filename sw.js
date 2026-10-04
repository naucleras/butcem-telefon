/* BÜTÇEM Telefon — çevrimdışı çalışma (service worker)       Sürüm 1 — 04.10.2026
 * Uygulama dosyalarını telefona kaydeder: internet yokken de açılır.
 * Strateji: önce telefondaki kopya (anında açılır), arka planda internetten
 * yenisi alınır; güncelleme bir sonraki açılışta görünür.
 * Google betiğine giden istekler (başka adres) buraya HİÇ uğramaz. */
const SURUM = 'butcem-telefon-v1';
const DOSYALAR = ['./', './index.html', './cekirdek.js', './manifest.webmanifest',
                  './simge-180.png', './simge-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SURUM).then(function (c) { return c.addAll(DOSYALAR); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (adlar) {
    return Promise.all(adlar.filter(function (a) { return a !== SURUM; })
                            .map(function (a) { return caches.delete(a); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  const istek = e.request;
  if (istek.method !== 'GET' || new URL(istek.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(SURUM).then(function (c) {
    return c.match(istek, { ignoreSearch: true }).then(function (kayitli) {
      const ag = fetch(istek).then(function (yanit) {
        if (yanit && yanit.ok) c.put(istek, yanit.clone());
        return yanit;
      }).catch(function () { return kayitli; });
      return kayitli || ag;
    });
  }));
});
