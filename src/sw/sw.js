/* -------------------------------------------------------------------------
    src/sw/sw.js – Service-Worker
    -------------------------------------------------------------------------
    ▸ Hauptaufgaben
        1) App-Shell + offline.html precache (install)
        2) Statisches Caching alter Versionen bereinigen (activate)
        3) Requests bedienen (fetch)
            • JS, Bilder & Icons - Network-First (Runtime-Cache)
            • HTML-Navigation - Network-First (+ Offline-Fallback)
            • Rest - Cache-First
        4) {type:'SKIP_WAITING'}-Nachricht empfangen (message)
    ---------------------------------------------------------------------- */
/* ========================== Konstanten ========================== */
// einheitlicher Präfix & scoped Cache-Name
const BASE_URL = self.registration.scope.replace(/src\/sw\/?$/, '');
const CACHE_PREFIX = 'handball-tracker';
const CACHE_VERSION = 'v3.15'; // Bei Upgrades die Version hochziehen
/**
 * Ein eindeutiger Cache-Name pro Deploy-Ort (Origin + Scope).
 * • vermeidet Kollisionen zwischen Dev-/Prod-Builds
 * • ersetzt alle früheren Stellen mit hardcodiertem String
 */
const CACHE_NAME =
    `${CACHE_PREFIX}-${BASE_URL.replace(/(^\w+:\/\/|\/$)/g, '')}-${CACHE_VERSION}`;

/* Pflicht-Assets für den Offline-Betrieb - alle Pfade relativ zum Scope */
const APP_SHELL = [
    '', // gleiches Ergebnis wie `${BASE_URL}`
    'index.html',
    'offline.html',
    'manifest.json',

    /* Core-Scripts */
    'src/js/header.js',
    'vendor/xlsx.full.min.js',
/*    'src/js/xlsx.full.min.js',*/
    'src/js/lib/idb-umd.js',
    'src/js/app.js',

    /* Styles (inkl. optionaler Source-Map) */
    'src/css/styles.css',

    /* Bilder */
    'src/images/goal-background.png',
    'src/images/scm_logo_sterne.jpg',

    /* Icons */
    'src/icons/icon-192.png',
    'src/icons/icon-512.png',
    'src/icons/icon-192-maskable.png',
    'src/icons/icon-512-maskable.png'
].map(path => new URL(path, BASE_URL).pathname);

/* -----------------------------------------------------------------------
    install – alles Notwendige zwischenspeichern
    -------------------------------------------------------------------- */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            await Promise.all(
                APP_SHELL.map(url =>
                    fetch(url, {cache: 'no-store'})
                        .then(r => { if (r.ok) return cache.put(url, r.clone()); })
                        // Response-Klon ablegen,
                        // falls Response-Body später noch anderweitig gelesen wird.
                        .catch(() => console.warn('[SW] Skip precache', url))
                )
            );
            await self.skipWaiting();
        })
    );
});

/* -----------------------------------------------------------------------
    activate – alte Caches bereinigen + neue SW-Instanz sofort übernehmen
    -------------------------------------------------------------------- */
self.addEventListener('activate', event => {
    // Alles in waitUntil kapseln, damit der Browser die Aktivierung
    //   nicht „zu früh“ beendet. So wird garantiert:
    //   1) Cache-Aufräumung fertig, 2) Clients übernommen (claim).
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
                .map(k => caches.delete(k))
        );
        await self.clients.claim(); // ► neue SW steuert sofort alle offenen Clients
    })());
});

/* -----------------------------------------------------------------------
    fetch – 3 Strategien
    -------------------------------------------------------------------- */
self.addEventListener('fetch', event => {
    const {request} = event;
    const url = new URL(request.url);

    /* 1) HTML-Navigation (seitenweite Aufrufe) ----------------------- */
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }

    /* 2) Runtime-Assets  (JS + Bilder)  ------------------------------ */
    /* Pfade relativ zum Scope ermitteln, damit Deploys unter /<prefix>/ sauber laufen */
    const SRC_PREFIX    = new URL('src/', BASE_URL).pathname; // z. B. '/app/src/'
    const VENDOR_PREFIX = new URL('vendor/', BASE_URL).pathname; // z. B. '/app/vendor/'

    /* 2) Runtime-Assets  (JS + Styles + Bilder + Icons + lib + vendor) ---- */
    // Statt auf absolute '/vendor/' prüfen wir gegen die Präfixe mit BASE_URL.
    const isSameOrigin = (url.origin === location.origin);
    const isRuntime =
        isSameOrigin && (
            url.pathname.startsWith(SRC_PREFIX) ||
            url.pathname.startsWith(VENDOR_PREFIX)
        );

    if (isRuntime) {
        event.respondWith(networkFirst(request));
        return;
    }

    /* 3) Default: Cache-First --------------------------------------- */
    event.respondWith(cacheFirst(request));
});

/* -----------------------------------------------------------------------
    message – sofortiges Update-Handling
    -------------------------------------------------------------------- */
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        // Sicherstellen, dass der neue SW nicht nur „aktiv“ wird,
        // sondern auch unmittelbar alle Clients übernimmt.
        event.waitUntil((async () => {
            console.log('[SW] ⚡ Skip Waiting empfangen – aktiviere neue Version');
            await self.skipWaiting();
            await self.clients.claim();

            // alle Fenster informieren (robust gegenüber fehlender source)
            const clients = await self.clients.matchAll({ type: 'window' });
            for (const c of clients) {
                c.postMessage({ type: 'CLIENTS_CLAIMED' });
            }
        })());
    }
});

/* ===== Hilfsfunktionen ================================================= */
/** Network-First – bei Fehlern Offline-Seite / Cache-Fallback */
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedPath = new URL(request.url).pathname.replace(/\?.*$/, '');
    try {
        const response = await fetch(request);
        if (request.method === 'GET' && response.ok) {
            await cache.put(cachedPath, response.clone());
        }
        return response;
    } catch (err) {
        /*  1) passende Cache-Kopie
            2) Offline-Fallback für HTML-Navigation */
        const cached = await cache.match(cachedPath);
        if (cached) return cached;

        if (request.mode === 'navigate') {
            const offlineURL = new URL('offline.html', BASE_URL).pathname;
            return cache.match(offlineURL);
        }
        throw err;
    }
}

/** Cache-First – Fallback - Network */
async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const resp = await fetch(request);
        if (request.method === 'GET' && resp.ok) {
            await cache.put(request, resp.clone());
        }
        return resp;
    } catch (err) {
        if (request.destination === 'image') {
            return new Response(
                `<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#ccc"/>
                <text x="50%" y="50%" font-size="20" dominant-baseline="middle" text-anchor="middle">Image offline</text>
            </svg>`,
                {headers: {'Content-Type': 'image/svg+xml'}}
            );
        }
        console.warn('[SW] Request fehlgeschlagen', request.url);
        throw err;
    }
}

// Ende src/sw/sw.js
