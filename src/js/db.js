// ============================================================================
//  src/js/db.js  –  IndexedDB-Wrapper mit Default-Daten für Areas & Match-Infos
//  ----------------------------------------------------------------------------
//  • Verwendet das UMD-Bundle »idb-umd.js« (liegt in src/js/lib/)
//  • Legt beim ersten Öffnen Default-Shot-, Goal-Areas und Match-Info-Stores an
//  • Bietet CRUD-Funktionen für Shots, Areas, Timer, Torwart, Show-Lines und Match-Infos
// ============================================================================

/* eslint-disable */
/**
 * @typedef { import('idb').IDBPDatabase<any> } IDBPDatabase
 * @typedef { import('idb').IDBPTransaction<any, any, 'readwrite' | 'readonly'> } IDBPTransaction
 */
/* eslint-enable */

/* ==== 1. UMD-Bibliothek laden ============================================= */
// Die UMD-Version liefert ein globales Objekt "idb"
if (!self.idb) {
    throw new Error('[db] idb-umd.js wurde nicht gefunden – Pfad prüfen!');
}
const {openDB} = idb;

/* ==== 2. Default-Areas definieren ======================================== */
/**
 * Default-Schusszonen (Shot-Areas) passend zum Spielfeld-Layout.
 * Jede Zone hat eine eindeutige id, einen Namen, eine Farbe und relative Koordinaten.
 *
 * Ein Befehl für die Console für die Zwangsentleerung der DB:
 *
 * indexedDB.deleteDatabase('handball-tracker');
 *
 */
const DEFAULT_SHOT_AREAS = [
    {
        id: 1, name: 'LA', color: '#00ba0a',
        coords: {x1: 0.01, y1: 0.27, x2: 0.50, y2: 0.27, x3: 0.01, y3: 0.55}
    },

    {
        id: 3, name: 'RA', color: '#00ba0a',
        coords: {x1: 0.50, y1: 0.27, x2: 0.99, y2: 0.27, x3: 0.99, y3: 0.55}
    },

    {
        id: 2, name: 'KM', color: '#00ba0a',
        coords: {
            x1: 0.50, y1: 0.27, x2: 0.1822, y2: 0.45, x3: 0.32, y3: 0.59,
            x4: 0.60, y4: 0.59, x5: 0.80, y5: 0.45
        }
    },

    {
        id: 4, name: 'DL', color: '#00ba0a',
        coords: {x1: 0.06, y1: 0.523, x3: 0.425, y3: 0.59}
    },

    {
        id: 5, name: 'DR', color: '#00ba0a',
        coords: {x1: 0.94, y1: 0.523, x3: 0.575, y3: 0.59}
    },

    {
        id: 6, name: 'DM', color: '#00ba0a',
        coords: {
            x1: 0.425, y1: 0.59, x2: 0.382, y2: 0.746,
            x3: 0.618, y3: 0.746, x4: 0.575, y4: 0.59
        }
    },

    /* ----------  6-Eck RL  ---------- */
    {
        id: 7, name: 'RL', color: '#00ba0a',
        coords: {
            x1: 0.01, y1: 0.55,   /* 9-m oben links            */
            x2: 0.01, y2: 0.99,  /* senkrecht zur 9-m unten   */
            x3: 0.31, y3: 0.99,   /* Grundlinie außen links    */
        }
    },

    /* ----------  6-Eck RR  ---------- */
    {
        id: 8, name: 'RR', color: '#00ba0a',
        coords: {
            x1: 0.99, y1: 0.55,
            x2: 0.99, y2: 0.99,
            x3: 0.69, y3: 0.99,
        }
    },

    /* ----------  RМ  ---------- */
    {
        id: 9, name: 'RM', color: '#00ba0a',
        coords: {
            x1: 0.382, y1: 0.746, x2: 0.308, y2: 0.99,
            x3: 0.692, y3: 0.99, x4: 0.618, y4: 0.746
        }
    },

    /* ---------- 7-m-Abschlusszone ---------- */
    {
        id: 10,
        name: '7m',
        color: '#8E070C',
        coords: {x1: 0.735, y1: 0.087, x2: 0.965, y2: 0.258}
    }
];

/**
 * Default-Torzonen (Goal-Areas) passend zum Spielfeld-Layout.
 * Drei Zonen oben, Drei in der Mitte, drei unten.
 */
const DEFAULT_GOAL_AREAS = [
    {id: 1, name: 'OL', color: '#8e070c', coords: {x1: 0.326, y1: 0.012, x2: 0.44, y2: 0.098}},
    {id: 2, name: 'OM', color: '#8e070c', coords: {x1: 0.44, y1: 0.012, x2: 0.555, y2: 0.10}},
    {id: 3, name: 'OR', color: '#8e070c', coords: {x1: 0.555, y1: 0.012, x2: 0.67, y2: 0.10}},
    {id: 4, name: 'ML', color: '#8e070c', coords: {x1: 0.326, y1: 0.098, x2: 0.44, y2: 0.184}},
    {id: 5, name: 'M', color: '#8e070c', coords: {x1: 0.44, y1: 0.098, x2: 0.555, y2: 0.184}},
    {id: 6, name: 'MR', color: '#8e070c', coords: {x1: 0.555, y1: 0.098, x2: 0.67, y2: 0.184}},
    {id: 7, name: 'UL', color: '#8e070c', coords: {x1: 0.326, y1: 0.184, x2: 0.44, y2: 0.27}},
    {id: 8, name: 'UM', color: '#8e070c', coords: {x1: 0.44, y1: 0.184, x2: 0.555, y2: 0.27}},
    {id: 9, name: 'UR', color: '#8e070c', coords: {x1: 0.555, y1: 0.184, x2: 0.67, y2: 0.27}}
];

/* ==== 3. Datenbank-Konstanten ============================================ */
const DB_NAME = 'handball-tracker';
const DB_VERSION = 13; // DB Version

/* ==== Rest der Logik ============================================ */

const STORE_SHOTS = 'shots';
const STORE_AREAS = 'areas';
const RIVAL_GK_KEY = 'currentRivalGoalkeeper';
const STORE_MATCH = 'matchInfo'; // Store für Match-Informationen
/*  ────────────────────────────────────────────────────────────────
 *  Ass-Zähler: wir verwenden – wie schon bei Show-Lines, Timer usw. –
 *  ebenfalls den STORE_AREAS als einfachen Key-Value-Store.
 * ──────────────────────────────────────────────────────────────── */
const ASS_KEY = 'assValue';
const SEVENG6_KEY = 'sevenG6';
const TOR_KEY = 'torValue';
const TF_KEY = 'tfValue';

/* ==== 4. Datenbank öffnen ====================================== */
/**
 * Öffnet (oder erstellt) die IndexedDB.
 *  – Bei neuer Installation werden Default-Daten geschrieben.
 *  – Bei Updates bleiben bestehende Daten unverändert
 *    (es gibt KEINE Migration mehr).
 *
 * @returns {Promise<IDBPDatabase>}
 */
export async function initDB() {
    return openDB(DB_NAME, DB_VERSION, {
        /* ----------------------------------------------------------------
         * Der upgrade-Callback DARF async sein (unterstützt von idb-lib).
         * ---------------------------------------------------------------- */
        async upgrade(db, oldVersion, newVersion, tx) {

            /* ────────────────────────────────────────────────────────────
             * 1) Shots-Store sicherstellen
             * ──────────────────────────────────────────────────────────── */
            if (!db.objectStoreNames.contains(STORE_SHOTS)) {
                db.createObjectStore(
                    STORE_SHOTS,
                    {keyPath: 'id', autoIncrement: true}
                );
            }

            /* ────────────────────────────────────────────────────────────
             * 2) Areas-Store **nur bei Erst-Installation** anlegen
             *    (kein Eingriff in bereits vorhandene Stores)
             * ──────────────────────────────────────────────────────────── */
            if (!db.objectStoreNames.contains(STORE_AREAS)) {
                const areasStore = db.createObjectStore(STORE_AREAS);
                areasStore.put(DEFAULT_SHOT_AREAS, 'shotAreas');
                areasStore.put(DEFAULT_GOAL_AREAS, 'goalAreas');

                /* Defaultwerte für *-Zählern = 0 anlegen */
                const zeroObj = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
                areasStore.put(zeroObj, ASS_KEY);
                areasStore.put(zeroObj, SEVENG6_KEY);
                areasStore.put(zeroObj, TOR_KEY);
                areasStore.put(zeroObj, TF_KEY);
            }

            /* ────────────────────────────────────────────────────────────
             * 3) MatchInfo-Store sicherstellen
             * ──────────────────────────────────────────────────────────── */
            if (!db.objectStoreNames.contains(STORE_MATCH)) {
                const miStore = db.createObjectStore(
                    STORE_MATCH,
                    {keyPath: 'id'}
                );
                ['competition', 'team', 'date', 'location',
                    'opponent', 'halftime', 'fulltime']
                    .forEach(key => miStore.put({id: key, value: ''}));
            }

            /* 4) Update von älteren DB-Versionen */
            if (oldVersion < 13) {

                const areasStore = tx.objectStore(STORE_AREAS);

                if (await areasStore.get(SEVENG6_KEY) === undefined) {
                    areasStore.put(
                        {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}},
                        SEVENG6_KEY
                    );
                }

                if (await areasStore.get(TOR_KEY) === undefined) {
                    areasStore.put(
                        {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}},
                        TOR_KEY
                    );
                }

                if (await areasStore.get(TF_KEY) === undefined) {
                    areasStore.put(
                        {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}},
                        TF_KEY
                    );
                }
            }
        }
    });
}

/* ==== 5. Areas (lesen / schreiben) ======================================= */
/** Liest Shot- und Goal-Areas, Fallback auf DEFAULT_... bei Fehlen. */
export async function getAreas() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const [shotAreas, goalAreas] = await Promise.all([
        tx.store.get('shotAreas'),
        tx.store.get('goalAreas')
    ]);
    await tx.done;
    return {
        shotAreas: shotAreas ?? DEFAULT_SHOT_AREAS,
        goalAreas: goalAreas ?? DEFAULT_GOAL_AREAS
    };
}

/** Speichert neue Shot- und Goal-Areas. */
export async function setAreas(shotAreas, goalAreas) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await Promise.all([
        tx.store.put(shotAreas, 'shotAreas'),
        tx.store.put(goalAreas, 'goalAreas')
    ]);
    await tx.done;
}

/* ==== 6. Shots CRUD ===================================================== */
/** Löscht einen Shot per Primärschlüssel */
export async function deleteShot(id) {
    const db = await initDB();
    await db
        .transaction(STORE_SHOTS, 'readwrite')
        .store.delete(id);
}

/** Liest alle Shots, sortiert nach Timestamp aufsteigend. */
export async function getShots() {
    const db = await initDB();
    const all = await db.transaction(STORE_SHOTS, 'readonly').store.getAll();
    return all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/** Fügt einen einzelnen Shot ein. */
export async function addShot(shot) {
    const db = await initDB();
    return await db
        .transaction(STORE_SHOTS, 'readwrite')
        .store.add(shot); // Rückgabewert ist die neue PK
}

/** Aktualisiert einen einzelnen Shot per Primärschlüssel (teilweise Felder möglich). */
// patchOrUpdater kann Objekt ODER Funktion (old - new) sein; gibt das aktualisierte Objekt zurück.
export async function updateShot(id, patchOrUpdater) {
    const db = await initDB();
    const tx = db.transaction(STORE_SHOTS, 'readwrite');
    const store = tx.store;

    const old = await store.get(id);
    if (!old) {
        await tx.done;
        throw new Error(`[db.updateShot] Kein Datensatz mit id=${id} gefunden`);
    }

    // patchOrUpdater anwenden (flach mergen) – Funktions- oder Objekt-Form unterstützen
    const patch = (typeof patchOrUpdater === 'function')
        ? patchOrUpdater(old)
        : patchOrUpdater;

    const updated = {...old, ...patch, id}; // ID sicherstellen
    await store.put(updated);
    await tx.done;
    return updated;
}

/** Fügt mehrere Shots gebündelt hinzu (z.B. Offline-Sync). */
export async function bulkAddShots(shotsArray) {
    if (!shotsArray.length) return;
    const db = await initDB();
    const tx = db.transaction(STORE_SHOTS, 'readwrite');

    for (const shot of shotsArray) {
        shot.id = await tx.store.add(shot); // jede ID merken
    }
    await tx.done;
}

/* ==== 7. Torwart-Zustand speichern & laden ================================ */

/**
 * Speichert den aktuellen Torwart-Zustand (1 oder 2) in IndexedDB.
 * @param {number} keeperId - aktuelle Nummer des Torwarts (1 oder 2)
 */
export async function setCurrentGoalkeeper(keeperId) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(keeperId, 'currentGoalkeeper');
    await tx.done;
}

/**
 * Liest den zuletzt gespeicherten Torwart-Zustand aus IndexedDB.
 * Falls keiner vorhanden ist, wird 1 zurückgegeben.
 * @returns {Promise<number>}
 */
export async function getCurrentGoalkeeper() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const value = await tx.store.get('currentGoalkeeper');
    await tx.done;
    return typeof value === 'number' ? value : 1;
}

// ----------  Rival-Keeper  ----------
export async function setCurrentRivalGoalkeeper(id = 1) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(id, RIVAL_GK_KEY);
    await tx.done;
}

export async function getCurrentRivalGoalkeeper() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const val = await tx.store.get(RIVAL_GK_KEY);
    await tx.done;
    return typeof val === 'number' ? val : 1;  // fallback = 1
}


/**
 * Speichert, ob die Verbindungslinien (Show Lines) angezeigt werden sollen.
 * @param {boolean} showLines - true = sichtbar, false = ausgeblendet
 */
export async function setShowShotLines(showLines) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(showLines, 'showShotLines');
    await tx.done;
}

/**
 * Liest den gespeicherten Show-Lines-Status aus IndexedDB.
 * Fallback: false (nicht sichtbar)
 * @returns {Promise<boolean>}
 */
export async function getShowShotLines() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const value = await tx.store.get('showShotLines');
    await tx.done;
    return value === true; // fallback = false
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Ass-Zähler lesen / schreiben
 * ──────────────────────────────────────────────────────────────────────────*/
export async function getAss() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const obj = await tx.store.get(ASS_KEY);
    await tx.done;
    // Fallback auf leere Struktur
    return obj ?? {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
}

export async function setAss(obj) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(obj, ASS_KEY);
    await tx.done;
}

/* ──────────────────────────────────────────────────────────────────────────
 *  7g6-Zähler lesen / schreiben
 * ──────────────────────────────────────────────────────────────────────────*/
export async function getSevenG6() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const obj = await tx.store.get(SEVENG6_KEY);
    await tx.done;
    return obj ?? {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
}

export async function setSevenG6(obj) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(obj, SEVENG6_KEY);
    await tx.done;
}

/* ---- Tor-Zähler ---------------------------------------------------- */
export async function getTor() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const obj = await tx.store.get(TOR_KEY);
    await tx.done;
    return obj ?? {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
}

export async function setTor(obj) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(obj, TOR_KEY);
    await tx.done;
}

/* ---- Technische-Fehler ------------------------------------------------ */
export async function getTF() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const obj = await tx.store.get(TF_KEY);
    await tx.done;
    return obj ?? {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
}

export async function setTF(obj) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put(obj, TF_KEY);
    await tx.done;
}


/**
 * Speichert aktuelle Game-Time in Sekunden sowie den Zustand (running oder nicht).
 * @param {number} seconds - aktuelle Spielzeit in Sekunden
 * @param {boolean} isRunning - true = Timer läuft, false = pausiert
 */
export async function setGameTimerState(seconds, isRunning) {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readwrite');
    await tx.store.put({seconds, isRunning}, 'gameTimer');
    await tx.done;
}

/**
 * Lädt den gespeicherten Timer-Zustand (Zeit und running-Status).
 * Falls noch nichts gespeichert wurde, liefert Standardwerte zurück.
 * @returns {Promise<{seconds: number, isRunning: boolean}>}
 */
export async function getGameTimerState() {
    const db = await initDB();
    const tx = db.transaction(STORE_AREAS, 'readonly');
    const value = await tx.store.get('gameTimer');
    await tx.done;

    // Falls value noch nicht existiert (null/undefined)
    if (!value || typeof value.seconds !== 'number' || typeof value.isRunning !== 'boolean') {
        return {seconds: 0, isRunning: false};
    }

    return {
        seconds: value.seconds,
        isRunning: value.isRunning
    };
}

/* ==== 8. Match-Info (Competition, Date, Location, Gegner, Halbzeit, Endstand) ===== */
/**
 * Liest alle Match-Info-Felder als Objekt { competition, date, location, opponent, halftime, fulltime }.
 * @returns {Promise<Record<string,string>>}
 */
export async function getMatchInfo() {
    const db = await initDB();
    const tx = db.transaction(STORE_MATCH, 'readonly');
    const all = await tx.store.getAll();
    await tx.done;
    // Reduziere Array auf { id: value }
    return all.reduce((acc, {id, value}) => {
        acc[id] = value;
        return acc;
    }, /** @type {Record<string,string>}*/({}));
}

/**
 * Speichert einen einzelnen Match-Info-Wert unter key = id.
 * @param {string} id – z.B. 'competition', 'date', 'location', 'opponent', 'halftime', 'fulltime'
 * @param {string} value – der einzugebende Text
 */
export async function setMatchInfo(id, value) {
    const db = await initDB();
    const tx = db.transaction(STORE_MATCH, 'readwrite');
    // Objekt mit keyPath 'id' überschreiben oder neu anlegen
    await tx.store.put({id, value});
    await tx.done;
}

// Ende src/js/db.js
