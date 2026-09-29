// Minimalus service worker – leidžia skydelį "įdiegti" telefone kaip programėlę (PWA).
// Duomenų nekešuojame (visada rodoma naujausia statistika).
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* tinklas pirmiausia – nieko nedarome */ });
