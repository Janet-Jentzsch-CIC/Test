// =====================================================================
// src/js/app.js – Hauptlogik der PWA (Erfassen, Visualisieren, Aggregieren)
// =====================================================================

/* global XLSX */ // ← teilt ESLint/VSC mit, dass XLSX eine Browser-Global ist

// == 1. Modul-Importe ==================================================
import './header.js';
import {
    ALPHA_GOAL_AREAS,
    ALPHA_SHOT_LEGACY,
    ALPHA_SHOT_RECT,
    ALPHA_STROKE_GOAL_AREAS,
    ALPHA_STROKE_SHOT_LEGACY,
    ALPHA_STROKE_SHOT_RECT
} from './config.js';
import {
    addShot,
    bulkAddShots,
    deleteShot,
    getAreas,
    getAss,
    getCurrentGoalkeeper,
    getCurrentRivalGoalkeeper,
    getGameTimerState,
    getMatchInfo,
    getSevenG6,
    getShots,
    getShowShotLines,
    getTF,
    getTor,
    initDB,
    setAreas,
    setAss,
    setCurrentGoalkeeper,
    setCurrentRivalGoalkeeper,
    setGameTimerState,
    setMatchInfo,
    setSevenG6,
    setShowShotLines,
    setTF,
    setTor,
    updateShot,
} from './db.js';
import {
    drawMarker,
    drawShotAreaLegacy,
    drawText,
    isPointInPolygon,
    isPointInShotAreaLegacy,
    relToCanvas
} from './canvasUtils.js';

/* --- Farb-/Linienkonstanten für Canvas-Rendering ---------------------
   COLOR_* steuern Marker- und Linienfarben; WIDTH/BLUR/SHADOW die Linie
   für optionale Verbindungslinien (Show Lines).
--------------------------------------------------------------------- */
const COLOR_TEMP_MARKER = '#888';
const COLOR_GOAL_TOR = '#ff0000';
const COLOR_GOAL_SAVE = '#00b050';

// Lines
const COLOR_LINES = '#ff55ff';
const WIDTH_LINES = 1.5;
const BLUR_LINES = 1;
const SHADOW_COLOR = '#0009';

/* ======================================================================
 * Gegenstoß-Overlay (virtueller Bereich auf dem Canvas)
 *  - rein visuell + klickbar (keine Änderung an shotAreas/DB nötig)
 *  - Klick markiert die Wurfkategorie 'GS' (Tempogegenstoß)
 *  - Geometrie in relativen 0..1-Koordinaten, damit responsive
 * ====================================================================*/

// Feature-Flag – bei Problemen schnell deaktivierbar
const ENABLE_GS_SECTOR = true;

// Stil für Füllung, Kontur (gepunktet) und Schraffur
const GS_STYLE = {
    fill: '#2e7d32', // Grundfarbe
    fillAlpha: 0.10, // Deckkraft der Füllung
    stroke: '#2e7d32', // Linienfarbe
    strokeAlpha: 0.75, // Deckkraft der Kontur
    dash: [8, 6], // gestrichelte Linie (Strich, Lücke)
    hatchAlpha: 0.15, // Deckkraft der Schraffur
    hatchStep: 18, // Abstand der Schraffur-Linien (px)
    hatchAngleDeg: -65 // Winkel der Schraffur-Linien (Grad)
};

/* Annäherungs-Polygon für den GS-Sektor.
   Diese Punkte sind *Startwerte* und passen auf das mitgelieferte Court-Bild.
   Bei anderem Hintergrund bitte feinjustieren (x, y jeweils 0..1).
   Form: leicht „bauchige“ Kappe knapp vor der 6-m-Linie.
*/
const GS_SECTOR_POLY = [
    {x: 0.22, y: 0.272}, // links oben an der Trennkante
    {x: 0.30, y: 0.272},
    {x: 0.40, y: 0.272},
    {x: 0.50, y: 0.272}, // mittlere Oberkante
    {x: 0.60, y: 0.272},
    {x: 0.70, y: 0.272},
    {x: 0.78, y: 0.272}, // rechts oben an der Trennkante

    // bauchige Unterkante (leicht nach unten gezogen, Halbkreis-Charakter)
    {x: 0.73, y: 0.37},
    {x: 0.65, y: 0.40},
    {x: 0.50, y: 0.42},   // am tiefsten
    {x: 0.35, y: 0.40},
    {x: 0.27, y: 0.37}
];

let ass = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
let sevenG6 = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
let torCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};
let tfCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

/* ===== Konstanten & globale Helfer ================================ */
const FIRST_HALF = 1;
const SECOND_HALF = 2;
const HALF_LENGTH = 30 * 60; // 30 min (Halbzeit)
const FULL_LENGTH = 60 * 60; // 60 min (Spielende)

/* == Feature toggles ================================================= */
/**
 * Quick 7m overlay (P/T) — temporarily disabled in the UI.
 * Keep implementation for future use. To re-enable, set to true.
 */
const ENABLE_SEVENM_QUICK = false;

export const GOALKEEPERS = {
    1: {number: 1, name: 'Hernandez'},
    2: {number: 80, name: 'Portner'}
};

// 2. Halbzeit nur, wenn beide Bedingungen erfüllt sind:
// (a) Zeit >= 30:00 und (b) der Nutzer hat nach HZ-Pause erneut „Start“ gedrückt.
function currentHalf() {
    if (gameSeconds >= HALF_LENGTH && secondHalfStarted) return SECOND_HALF;
    return FIRST_HALF;
}

/**
 * Aktualisiert alle UI-Elemente, die von Halbzeit und aktivem Torwart abhängen:
 * – Badges (Ass, 7g6, Tor, TF)
 * – Aggregations-Tabelle (eigene Keeper)
 * Wird aufgerufen z. B. beim Halbzeitwechsel oder GK-Wechsel.
 */
function refreshHalfDependentUI() {
    updateAssBadge();
    updateSevenG6Badge();
    updateTorBadge();
    updateTFBadge();
    renderGKStatTable();
}

/* =====================================================================
 * 1.1 Badge Updates
 * ===================================================================*/

/* Gemeinsamer Helper – liefert „#1“ bzw. „#80“
   (Fällt auf Torwart-Index zurück, falls Nummer fehlt/leer) */
function gkNumLabel(gkId) {
    const meta = GOALKEEPERS[gkId] || {};
    const num = Number.isFinite(meta.number) ? meta.number : gkId;
    return `#${num}`;
}

/* -------------------- GK-Metadaten-Handling ------------------------- */
/** Übernimmt GK-Metadaten in GOALKEEPERS und stößt alle nötigen UI-Refreshes an. */
function applyGoalkeeperMeta(meta = {}) {
    const g1 = meta.gk1 || {};
    const g2 = meta.gk2 || {};

    // Nummern nur übernehmen, wenn valide Zahl; sonst auf „undefined“ lassen - Fallback greift
    if (Number.isFinite(g1.number)) GOALKEEPERS[1].number = g1.number; else GOALKEEPERS[1].number = undefined;
    GOALKEEPERS[1].name = (g1.name || '').trim();

    if (Number.isFinite(g2.number)) GOALKEEPERS[2].number = g2.number; else GOALKEEPERS[2].number = undefined;
    GOALKEEPERS[2].name = (g2.name || '').trim();

    refreshGoalkeeperMetaUI();
}

/** Liest GK-Metadaten aus IndexedDB (MatchInfo) und wendet sie an. */
async function hydrateGoalkeepersFromMatchInfo() {
    try {
        const mi = await getMatchInfo();
        applyGoalkeeperMeta({
            gk1: {number: parseInt(mi.gk1Number, 10), name: mi.gk1Name},
            gk2: {number: parseInt(mi.gk2Number, 10), name: mi.gk2Name}
        });
    } catch (e) {
        console.warn('[GK] MatchInfo lesen fehlgeschlagen', e);
    }
}

/** Zentraler UI-Refresh nach GK-Meta-Änderung. */
function refreshGoalkeeperMetaUI() {
    updateGoalkeeperButton();   // Toggle-Label (#Nummer Name)
    updateStatsHeading();       // H2 mit #Nummer
    refreshHalfDependentUI();   // Badges + große GK-Tabelle
    renderShotTable();          // kleine Shot-Tabelle
    renderGkOverviewTable();    // Übersicht
    drawAreas();                // Canvas (Minutenlabels etc.)
}

/* Event aus header.js abonnieren (sofort wirksam beim Tippen/Ändern) */
window.addEventListener('gk-meta-change', (ev) => {
    applyGoalkeeperMeta(ev?.detail || {});
});


/* =====================================================================
 * 1.1 Badge-Updates – Assists
 * ===================================================================*/
function updateAssBadge() {
    const gk = currentGoalkeeper;
    const half = currentHalf(); // 1. oder 2. Halbzeit
    const box = document.querySelector('#ass-value');
    if (!box) return;
    box.innerHTML =
        `<div style="font-size:.85em">${gkNumLabel(gk)}<br>${half}. HZ</div>
         <div style="font-weight:700">${ass[gk][half]}</div>`;

    /* Minus-Button deaktivieren, wenn Wert 0 ----------------------- */
    const decBtn = document.getElementById('ass-decrement');
    if (decBtn) decBtn.disabled = ass[gk][half] === 0;
}

/* =====================================================================
 * 1.2 Badge-Updates – 7 gegen 6
 * ===================================================================*/
function updateSevenG6Badge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();
    const box = document.querySelector('#seven-g6-value');
    if (!box) return;
    box.innerHTML =
        `<div style="font-size:.85em">${gkNumLabel(gk)}<br>${half}. HZ</div>
         <div style="font-weight:700">${sevenG6[gk][half]}</div>`;

    const dec = document.getElementById('seven-g6-decrement');
    if (dec) dec.disabled = sevenG6[gk][half] === 0;
}

/* =====================================================================
 * 1.3 Badge-Updates – Eigene Tore
 * ===================================================================*/
function updateTorBadge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();
    const box = document.querySelector('#tor-value');
    if (!box) return;
    box.innerHTML =
        `<div style="font-size:.85em">${gkNumLabel(gk)}<br>${half}. HZ</div>
         <div style="font-weight:700">${torCount[gk][half]}</div>`;

    const dec = document.getElementById('tor-decrement');
    if (dec) dec.disabled = torCount[gk][half] === 0;
}

/* =====================================================================
 * 1.4 Badge-Updates – Technische Fehler
 * ===================================================================*/
function updateTFBadge() {
    const gk = currentGoalkeeper;
    const half = currentHalf();
    const box = document.querySelector('#tf-value');
    if (!box) return;
    box.innerHTML =
        `<div style="font-size:.85em">${gkNumLabel(gk)}<br>${half}. HZ</div>
         <div style="font-weight:700">${tfCount[gk][half]}</div>`;

    const dec = document.getElementById('tf-decrement');
    if (dec) dec.disabled = tfCount[gk][half] === 0;
}

/* --- 1.2 Spezial-Konstante: virtuelle Goal-Area für 7m -------- */
/* --------------------------------------------------------------
   Zuordnung von Wurfkategorie - Statistikspalte.
   – Synonyme abgedeckt (z. B. 'durchbruch' - 'km')
   – historische Bezeichnungen normalisiert (Kreis = 'km', Durchbruch zählt wie 'km')
-------------------------------------------------------------- */
const AREA_TO_COL = {
    rl: 'rl', rm: 'rm', rr: 'rr',
    la: 'la', ra: 'ra',
    dl: 'dl', dm: 'dm', dr: 'dr',
    km: 'km',
    db: 'km', durchbruch: 'km',
    gegenstoss: 'gs',
    gs: 'gs',
    '7m': '7m'
};

/* ---- Paraden (links) ------------------- */
const LEFT_COL_MAP = {
    rl: 3, rm: 4, rr: 5,
    km: 6,
    la: 7, ra: 8,
    dl: 9, dm: 10, dr: 11,
    gs: 12, '7m': 13
};

/* ---- Gegentore (rechts) ---------------- */
const RIGHT_COL_MAP = {
    rl: 18, rm: 19, rr: 20,
    km: 21,
    la: 22, ra: 23,
    dl: 24, dm: 25, dr: 26,
    gs: 27, '7m': 28
};

/* == Globale Laufzeit-States =========================================
   Alle erfassten Würfe werden in `shots` gehalten (Quelle der Wahrheit).
   Persistente Einträge (IndexedDB) haben eine `id`, offline erfasste noch nicht.
==================================================================== */
let shots = []; // alle Würfe – synchron & un-synchron
let shotAreas = []; // Liste der Shot-Areas (Wurfzonen)
let goalAreas = []; // Liste der Goal-Areas (Torzonen)

/* ======= RIVAL GK Tracking ========================================= */

let currentRivalGoalkeeper = 1; // Start = Torwart 1
let currentRivalPos = null; // zuletzt geklickte Wurfposition

// Buttons erst aktivieren, sobald eine Position gewählt ist
const enableRivalActionBtns = onOff => {
    void onOff; // bewusst ungenutzt: API stabil halten, Aufrufer dürfen weiterhin true/false übergeben
    updateRivalUndoState();
};

function updateRivalUndoState() {
    const hasRows = shots.some(
        s => s.team === 'rival' && (s.goalkeeperId ?? 1) === currentRivalGoalkeeper
    );
    const undo = document.getElementById('undo-btn-rival');
    if (!undo) return;
    undo.disabled = !hasRows;
    undo.classList.toggle('active', hasRows);
}

// --- Caches --------------------
let shotAreaMap = new Map(); // id - das entsprechende Zonenobjekt
let goalAreaMap = new Map(); // id - das entsprechende Zonenobjekt

/* Registrierung-Workflow */
let currentStep = 1;
let currentShotPosition = null; // aktuell ausgewählte Shot-Area
let currentExactShotPos = null; // genaues rel. Koordinatenobjekt {x,y}
let currentExactGoalPos = null; // genaues rel. Koordinatenobjekt {x,y}

/* Ausgewählte Tor-Zone (per 2. Klick), dauerhaft bis Finish/Clear */
let currentGoalArea = null; // {id,name,coords,...} oder null

/* UI-Modi */
let showShotLines = false; // toggelt Verbindungslinien ein/aus

/* Canvas & Timer */
let canvas, ctx; // Canvas-Element + 2D-Context
let canvasWidth = 0; // aktuelle Breite des Darstellungsbereichs
let canvasHeight = 0; // aktuelle Höhe des Darstellungsbereichs
let gameSeconds = 0; // Gesamtzeit in Sekunden (Game Time)
let gameInterval = null; // Rückgabewert von setInterval
let gameRunning = false; // true = Timer läuft

/* Table cols */
const COLS = 33;

/**
 * Globale Variable für den aktuell gewählten Torwart.
 * Initial ist Torwart 1 aktiv.
 */
let currentGoalkeeper = 1;

/* ------------------------------------------------------------------
   Halbzeit-Steuerung: 2. HZ startet erst nach erneutem Start-Klick
   ------------------------------------------------------------------ */
let secondHalfStarted = false; // persistent via localStorage

// Aus localStorage laden (robust gegen Private-Mode)
function loadSecondHalfStarted() {
    try {
        secondHalfStarted = localStorage.getItem('secondHalfStarted') === '1';
    } catch {
    }
}

// In localStorage speichern
function saveSecondHalfStarted() {
    try {
        localStorage.setItem('secondHalfStarted', secondHalfStarted ? '1' : '0');
    } catch {
    }
}

// == 3. Boot-Strap =====================================================
document.addEventListener('DOMContentLoaded', () =>
    initApp().catch(err => console.error('[BOOT] Fehler:', err))
);

/**
 * Initialisiert die App einmalig:
 * – IndexedDB laden (Shots, Zähler, Areas, Settings)
 * – Canvas/Timer/UI aufbauen, Event-Bindings setzen
 * – erst eigene Sichten rendern, dann Rival (konsistente Reihenfolge)
 * – Service Worker und Online/Offline-Behandlung aktivieren
 */
async function initApp() {
    /* IndexedDB initialisieren */
    await initDB();

    // GK-Metadaten früh ziehen, damit alle nachfolgenden UI-Bausteine
    // (Badges/Tabellen) bereits die richtigen Nummern/Namen anzeigen.
    await hydrateGoalkeepersFromMatchInfo();

    // HT/FT-Ausgabe initial synchronisieren
    await updateScoreDisplays();

    // Bei manueller Eingabe live spiegeln
    document.getElementById('halftime-input')?.addEventListener('input', updateScoreDisplays);
    document.getElementById('fulltime-input')?.addEventListener('input', updateScoreDisplays);


    // --- 2. HZ-Flag aus localStorage vor Timer/UI laden -----------------------
    loadSecondHalfStarted();

    // _____ Ass __________________________________________________________________
    ass = await getAss();

    // 2) Sicherstellen, dass die erwartete Struktur vorhanden ist
    if (!ass || typeof ass !== 'object') ass = {};
    for (const gk of [1, 2]) {
        ass[gk] ??= {};
        ass[gk][1] = Number(ass[gk][1] ?? 0);
        ass[gk][2] = Number(ass[gk][2] ?? 0);
    }

    // 3) Default persistieren
    await setAss(ass);
    updateAssBadge();

    /* „−“-Button initial deaktivieren, falls Wert == 0 */
    const decBtn = document.getElementById('ass-decrement');
    if (decBtn) {
        decBtn.disabled = ass[currentGoalkeeper][currentHalf()] === 0;
    }

    currentGoalkeeper = await getCurrentGoalkeeper();

    // _____ 7g6-Zähler __________________________________________________________________
    sevenG6 = await getSevenG6();
    if (!sevenG6 || typeof sevenG6 !== 'object') sevenG6 = {};
    for (const gk of [1, 2]) {
        sevenG6[gk] ??= {};
        sevenG6[gk][1] = Number(sevenG6[gk][1] ?? 0);
        sevenG6[gk][2] = Number(sevenG6[gk][2] ?? 0);
    }

    await setSevenG6(sevenG6);
    updateSevenG6Badge();

    /* _____ Tor-Zähler ______________________________________________ */
    torCount = await getTor();
    if (!torCount || typeof torCount !== 'object') torCount = {};
    for (const gk of [1, 2]) {
        torCount[gk] ??= {};
        torCount[gk][1] = Number(torCount[gk][1] ?? 0);
        torCount[gk][2] = Number(torCount[gk][2] ?? 0);
    }

    await setTor(torCount);
    updateTorBadge();

    // „–“-Button gleich beim Laden deaktivieren, wenn Wert 0 ist
    const torDec = document.getElementById('tor-decrement');
    if (torDec) torDec.disabled = torCount[currentGoalkeeper][currentHalf()] === 0;

    /* _____ TF-Zähler _____________________________________________________________ */
    tfCount = await getTF();

    /* Defensive – falls DB leer ist oder falscher Typ geliefert wird */
    if (!tfCount || typeof tfCount !== 'object') tfCount = {};

    for (const gk of [1, 2]) {
        tfCount[gk] ??= {};
        tfCount[gk][1] = Number(tfCount[gk][1] ?? 0);
        tfCount[gk][2] = Number(tfCount[gk][2] ?? 0);
    }
    await setTF(tfCount);
    updateTFBadge();

    // „–“-Button gleich beim Laden deaktivieren, wenn Wert 0 ist
    const tfDec = document.getElementById('tf-decrement');
    if (tfDec) tfDec.disabled = tfCount[currentGoalkeeper][currentHalf()] === 0;

    // „–“-Button gleich beim Laden deaktivieren, wenn Wert 0 ist
    const g6Dec = document.getElementById('seven-g6-decrement');
    if (g6Dec) g6Dec.disabled = sevenG6[currentGoalkeeper][currentHalf()] === 0;

    /* Stammdaten (Areas + bereits existierende Shots) laden */
    const areas = await getAreas();

    // Defensive – falls DB leer ist, mit leeren Arrays weiterarbeiten
    const safeAreas = areas ?? {shotAreas: [], goalAreas: []};

    shotAreas = safeAreas.shotAreas;
    goalAreas = safeAreas.goalAreas;

    // lookup maps
    shotAreaMap = new Map(shotAreas.map(a => [a.id, a]));
    goalAreaMap = new Map(goalAreas.map(a => [a.id, a]));

    shots = await getShots();

    /* Canvas + Timer + UI */
    initCanvas();
    await initTimers();
    updateStatsHeading(); // korrigiert Überschrift gleich beim Start

    // Show-Lines-Status aus IndexedDB wiederherstellen
    showShotLines = await getShowShotLines();
    const checkbox = document.getElementById('show-lines-toggle');
    if (checkbox) checkbox.checked = showShotLines;
    currentRivalGoalkeeper = await getCurrentRivalGoalkeeper();
    setupEventListeners();
    initAreaEditors();
    updateStatistics(); // Zeichnet erstes Stats-Bild, noch ohne Shots
    drawAreas(); // Rendert alle Areas (Shot + Goal)

    /* Online/Offline-Sync */
    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    await handleConnectionChange();

    /* Service-Worker-Lifecycle */
    initServiceWorkerLifecycle();
    updateButtonStates();
    renderShotTable();

    // Radial-Menü initialisieren/binden (nach erstem Tabellen-Render)
    ensureShotRadialMenu();
    bindShotTableRadial();
    bindShotRadialApply();


    renderGkOverviewTable();
    enableRivalActionBtns(false);

    /* ---- Rival-GK aus IndexedDB laden --------------------------- */
    const rivalToggle = document.querySelector('.gk-overview-toggle-btn');

    if (rivalToggle) {
        updateRivalGoalkeeperButton();
    }

    renderRivalShotTable();
    renderRivalGKStatTable();
    updateRivalUndoState();
    initRivalAccordion();
}

/**
 * Initialisiert das Rival-Accordion:
 * – Kleiner Handle-Button links oben am Tabellen-Wrapper
 * – Chevron + Label im Handle (kompakt, mobile-freundlich)
 * – Zustand (auf/zu) in localStorage persistiert
 * – A11y: aria-expanded, Tastaturbedienung (Enter/Space)
 */
function initRivalAccordion() {
    // Wrapper & Tabelle greifen; defensiv beenden, wenn nicht vorhanden
    const wrapper = document.getElementById('rival-gk-stat-wrapper');
    const table = document.getElementById('rival-gk-stat-table');
    if (!wrapper || !table) return;

    // -- Basis: Wrapper für Positionierung vorbereiten (CSS nutzt dies)
    wrapper.classList.add('rival-accordion');

    // -- Klick-Hotspot/Handle oben links anlegen (kleine Fläche, auch mobile-tauglich)
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'rival-acc-handle';
    handle.setAttribute('aria-label', 'Rival-Statistik ein-/ausklappen'); // a11y
    handle.setAttribute('aria-expanded', 'false');
    handle.title = 'Rival-Statistik öffnen';

    // handle.textContent = '▸';
    // Pfeil-Rechts = zugeklappt
    handle.innerHTML = `<span class="chev" aria-hidden="true">▸</span>
    <span class="lbl">Rival-Statistik</span>`;

    wrapper.appendChild(handle);

    // Persistenz-Keys für Accordion-Zustand + einmalige „Hint“-Markierung
    const LS_KEY = 'rivalAccordionOpen';
    const LS_SEEN = 'rivalAccordionSeen';

    // localStorage defensiv lesen (z. B. iOS Private Mode)
    let initiallyOpen = false;
    try {
        initiallyOpen = (localStorage.getItem(LS_KEY) === '1');
    } catch {
    }

    if (!initiallyOpen) {
        wrapper.classList.add('is-collapsed');
        handle.setAttribute('aria-expanded', 'false');
        handle.title = 'Rival-Statistik öffnen';

        // Chevron im vorhandenen <span class="chev"> setzen (Markup nicht zerstören)
        const chev = handle.querySelector('.chev');
        if (chev) chev.textContent = '▸';
    } else {
        handle.setAttribute('aria-expanded', 'true');
        handle.title = 'Rival-Statistik schließen';

        // Chevron im vorhandenen <span class="chev"> setzen (Markup nicht zerstören)
        const chev = handle.querySelector('.chev');
        if (chev) chev.textContent = '▾';
    }

    // Einmalige Hint-Animation anzeigen, wenn der Nutzer das Accordion noch nie geöffnet hat
    try {
        if (localStorage.getItem(LS_SEEN) !== '1') {
            handle.classList.add('hint'); // CSS-Animation läuft (siehe .rival-acc-handle.hint)
        }
    } catch {
        /* localStorage evtl. deaktiviert/gefüllt – stillschweigend ignorieren */
    }

    // -- Toggle-Funktion (Klasse + a11y + persistenter Zustand)
    const toggle = () => {
        const collapsed = wrapper.classList.toggle('is-collapsed');
        handle.setAttribute('aria-expanded', String(!collapsed));
        handle.title = collapsed ? 'Rival-Statistik öffnen' : 'Rival-Statistik schließen';

        const chevEl = handle.querySelector('.chev'); // robust gegen fehlendes Markup
        if (chevEl) chevEl.textContent = collapsed ? '▸' : '▾';

        try {
            localStorage.setItem(LS_KEY, collapsed ? '0' : '1');
            if (!collapsed) {
                localStorage.setItem(LS_SEEN, '1');
                handle.classList.remove('hint');
            }
        } catch {
        }
    };

    // -- Events: Klick/Touch auf den Handle, sowie Tastatur (Enter/Space)
    handle.addEventListener('click', toggle);
    handle.addEventListener('keydown', (e) => {
        // Space in älteren Browsern als 'Spacebar' benannt; e.code ist stabil.
        const isSpace = e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space';
        if (e.key === 'Enter' || isSpace) {
            e.preventDefault();
            toggle();
        }
    });

    wrapper.addEventListener('click', (e) => {
        if (e.target !== wrapper) return; // andere Kinder ignorieren (z.B. Tabelle)
        const r = wrapper.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        if (x <= 44 && y <= 28) toggle();
    }, true);
}

// == 4. Canvas-Initialisierung =========================================
/** Bindet Canvas und Hintergrundbild; setzt Größe und Redraw-Hooks (Resize/Image-Load). */
function initCanvas() {
    canvas = document.getElementById('court-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    const bg = document.getElementById('background-image');

    // Lokaler Helper: Canvas-Backing-Size setzen + 7m-Overlay initialisieren/platzieren
    const setup = () => {
        setCanvasSize(); // triggers full redraw

        // 7m overlay currently disabled: don't create; if present (legacy), hide.
        if (ENABLE_SEVENM_QUICK) {
            ensureSevenMQuickBtn();
        } else {
            const btn = document.getElementById(SEVENM_BTN_ID);
            if (btn) btn.setAttribute('hidden', 'true');
        }
    };

    // Wenn kein Bild vorhanden ODER bereits geladen dann sofort einrichten,
    // sonst beim Laden (onload) nachziehen.
    if (!bg || (bg.complete && bg.naturalWidth > 0)) {
        setup();
    } else {
        bg.onload = setup;
    }

    // Redraw/Resize-Hook
    window.addEventListener('resize', setCanvasSize);
}

/**
 * Passt die Canvas-Backing-Size exakt an den sichtbaren Viewport an
 * (nicht Container-CSS-Werte) und triggert einen vollständigen Redraw.
 */
function setCanvasSize() {
    const r = canvas.getBoundingClientRect();
    canvasWidth = Math.round(r.width);
    canvasHeight = Math.round(r.height);
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    window.canvasWidth = canvasWidth;
    window.canvasHeight = canvasHeight;

    drawAreas();

    // Nach dem Redraw die 7m-Schaltfläche passend verschieben
    placeSevenMQuickBtn();
}

// == 5. Event-Binding & UI-Helper =======================================
const on = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
};

function upgradeRivalPosButtons() {
    // Root-Container der Positions-Buttons
    const container = document.querySelector('.gk-overview-positions-btns-container');
    if (!container) return;

    // Alle bestehenden Positions-Buttons greifen
    const btns = container.querySelectorAll('.gk-overview-action-btn');

    btns.forEach(btn => {
        // Ursprüngliches Label sichern (z. B. "RA")
        const label = (btn.textContent || '').trim();
        if (!label) return;

        // Normalisierte Positions-ID einmalig auf das Button-Element legen
        // (so sind wir robust, auch wenn das HTML innen später erweitert wird)
        btn.dataset.pos = label.toLowerCase();

        if (btn.dataset.upgraded === '1') return;

        btn.innerHTML = `
          <span class="rival-mini rival-mini--neg" data-quick="save" aria-label="Parade">P</span>
          <span class="rival-label">${label}</span>
          <span class="rival-mini rival-mini--pos" data-quick="goal" aria-label="Tor">T</span>
        `;

        btn.dataset.upgraded = '1';
    });

    if (!container.dataset.quickBound) {
        container.addEventListener('click', (e) => {
            // Prüfen, ob auf einen Mini-Button (−/+) geklickt wurde
            const quickEl = e.target.closest('.rival-mini[data-quick]');
            if (!quickEl) return; // normaler Klick - Pos.-Auswahl (bestehende Logik)
            e.stopPropagation(); // verhindert Auslösen der Host-Button-Logik

            // Zugehörigen Host-Button und seine Pos.-ID ermitteln
            const hostBtn = quickEl.closest('.gk-overview-action-btn');
            if (!hostBtn) return;
            const pos = hostBtn.dataset.pos;
            if (!pos) return;

            // Gewählte Position kurzzeitig setzen und Quick-Shot speichern
            //  − data-quick="save" - Parade
            //  + data-quick="goal" - Tor
            currentRivalPos = pos;
            const isSave = quickEl.dataset.quick === 'save';

            void finishRivalShot(isSave); // bewusst "fire-and-forget": UI-Flow nicht blockieren
        });
        container.dataset.quickBound = '1';
    }
}

/* ============================================================================
 *  ┌───────────────┬───────┐
 *  │ LA | KM | RA  │  7m   │
 *  │ RL | RM | RR  │  GS   │
 *  │               │  DB   │
 *  └───────────────┴───────┘
 * ========================================================================== */

function ensureRivalButtonsLayout() {
    // 0) Root-Container
    /** @type {HTMLDivElement|null} */
    const root = document.querySelector('.gk-overview-positions-btns-container');
    if (!root) return;

    // 1) CSS
    if (!document.getElementById('rival-layout-style')) {
        const css = document.createElement('style');
        css.id = 'rival-layout-style';
        css.textContent = `
      .rival-btns-layout{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
      .rival-btns-grid{display:grid;grid-template-columns:repeat(3,minmax(88px,auto));gap:12px}
      .rival-btns-side{display:grid;gap:12px}
      .rival-btns-side .gk-overview-action-btn{justify-content:space-between}
    `;
        document.head.appendChild(css);
    }

    root.classList.add('rival-btns-layout');

    /** @param {string} cls @returns {HTMLDivElement} */
    const ensureChildDiv = (cls) => {
        /** @type {HTMLDivElement|null} */
        let el = root.querySelector(`:scope > .${cls}`);
        if (!el) {
            el = document.createElement('div');
            el.className = cls;
            root.appendChild(el);
        }
        return /** @type {HTMLDivElement} */ (el);
    };

    const grid = ensureChildDiv('rival-btns-grid');
    const side = ensureChildDiv('rival-btns-side');

    /** @type {HTMLButtonElement[]} */
    const all = Array.from(root.querySelectorAll('button.gk-overview-action-btn'));

    /** @type {Map<string, HTMLButtonElement>} */
    const byPos = new Map(all.map(b => [String(b.dataset.pos ?? '').toLowerCase(), b]));

    const GRID_ORDER = ['la', 'km', 'ra', 'rl', 'rm', 'rr'];
    const SIDE_ORDER = ['7m', 'gs', 'db'];

    grid.innerHTML = '';
    side.innerHTML = '';

    GRID_ORDER.forEach(k => {
        const btn = byPos.get(k);
        if (btn) grid.appendChild(btn);
    });

    SIDE_ORDER.forEach(k => {
        const btn = byPos.get(k);
        if (btn) side.appendChild(btn);
    });

    all.forEach(b => {
        const k = String(b.dataset.pos || '').toLowerCase();
        if (!GRID_ORDER.includes(k) && !SIDE_ORDER.includes(k)) grid.appendChild(b);
    });
}

/* ============================================================================
 * Stellt sicher, dass ein "GS"-Positionsbutton existiert.
 * ========================================================================== */
function ensureRivalGSButton() {
    const container = document.querySelector('.gk-overview-positions-btns-container');
    if (!container) return;

    // Bereits vorhanden? (via data-pos oder sichtbarer Text)
    const exists = Array.from(container.querySelectorAll('.gk-overview-action-btn'))
        .some(b =>
            (b.dataset.pos || '').toLowerCase() === 'gs' ||
            (b.textContent || '').trim().toUpperCase() === 'GS'
        );
    if (exists) return;

    // ► Neu anlegen (roh); upgradeRivalPosButtons() sorgt für P|Label|T
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gk-overview-action-btn';
    btn.textContent = 'GS';
    btn.dataset.pos = 'gs';
    container.appendChild(btn);
}

function pruneLegacyRivalButtons() {
    // IDs der veralteten Buttons
    const LEGACY_IDS = ['goal-btn-rival', 'goalkeeper-save-btn-rival', 'cancel-btn-rival'];

    // Buttons (falls vorhanden) entfernen - kein Fokus, keine Tastatur-Reihenfolge
    LEGACY_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentElement) el.parentElement.removeChild(el);
    });
}

/**
 * Verdrahtet alle UI-Events:
 * – Spieluhr (Start/Pause/Reset, ±-Sekunden)
 * – Canvas-Klickworkflow (Wurf - Torzone)
 * – Ergebnis-Buttons (Tor/Gehalten/Abbrechen/Undo)
 * – Optionen (Show Lines)
 * – Zähler-Buttons (Ass/7g6/Tor/TF)
 * – GK-Wechsel (eigen & Rival)
 * – Export / Clear All / Offline-Hinweise
 */
function setupEventListeners() {
    /* Timer */
    on('start-pause-btn', 'click', toggleGameTimer);

    /* ------------------------------------------------------------------
     * Reset-Button: vor dem Zurücksetzen der Spielzeit eine Nachfrage anzeigen.
     * ------------------------------------------------------------------ */
    on('reset-btn', 'click', () => {
        const msg =
            'Wirklich die Spielzeit auf 0:00 zurücksetzen?\n' +
            '(Der Timer wird gestoppt und auf 0 gesetzt.)';

        // Abbruch, wenn der Nutzer verneint
        if (!confirm(msg)) return;

        // Ausführen wie bisher
        resetGameTimer();
    });

    pruneLegacyRivalButtons();

    /* Manuelle ±-Buttons */
    on('rewind-fast-btn', 'click', () => adjustGameSeconds(-10)); // «<<
    on('rewind-btn', 'click', () => adjustGameSeconds(-1)); // «
    on('forward-btn', 'click', () => adjustGameSeconds(+1)); // »
    on('forward-fast-btn', 'click', () => adjustGameSeconds(+10)); // »»

    if (canvas) canvas.addEventListener('click', handleCanvasClick);

    /* Ergebnis-Buttons */
    on('goal-btn', 'click', () => finishShot(false));
    on('goalkeeper-save-btn', 'click', () => finishShot(true));
    on('cancel-btn', 'click', resetRegistrationProcess);

    /* Show-Lines-Toggle */
    on('show-lines-toggle', 'change', async e => {
        showShotLines = e.target.checked;
        await setShowShotLines(showShotLines);
        drawAreas();
    });

    /* Globale Aktionen: Export, Undo, Clear All */
    on('export-btn', 'click', exportData);
    on('undo-btn', 'click', undoLastShot);

    /* CLEAR ALL mit Sicherheitsfrage */
    on('clear-btn', 'click', async () => {
        const msg = 'Wirklich ALLES zurücksetzen?\n' +
            '(Shots, Timer, Show-Lines, Torwart …)';
        if (!confirm(msg)) return;
        await hardResetGame();
    });

    /* === Ass Buttons ================================== */
    on('ass-increment', 'click', () => changeAss(+1));
    on('ass-decrement', 'click', () => changeAss(-1));

    /* === 7g6 Buttons =================================== */
    on('seven-g6-increment', 'click', () => changeSevenG6(+1));
    on('seven-g6-decrement', 'click', () => changeSevenG6(-1));

    /* === Tor Buttons ==================================== */
    on('tor-increment', 'click', () => changeTor(+1));
    on('tor-decrement', 'click', () => changeTor(-1));

    /* === TF Buttons ==================================== */
    on('tf-increment', 'click', () => changeTF(+1));
    on('tf-decrement', 'click', () => changeTF(-1));

    /* Torwart-Toggle initialisieren */
    changeGoalkeeper().catch(err => console.error('[GK] Fehler:', err));

    /* --------------------------------------------------
     * RIVAL – Positions- & Action-Buttons
     * -------------------------------------------------- */
    ensureRivalGSButton();
    upgradeRivalPosButtons();
    ensureRivalButtonsLayout();

    (function tweakGsColors() {
        const gsBtn = document.querySelector('.gk-overview-action-btn[data-pos="gs"]');
        if (!gsBtn) return;
        const miniSave = gsBtn.querySelector('.rival-mini[data-quick="save"]');
        const miniGoal = gsBtn.querySelector('.rival-mini[data-quick="goal"]');
        if (miniSave) miniSave.style.color = '#00b050'; // Grün = Parade
        if (miniGoal) miniGoal.style.color = '#ff0000'; // Rot = Tor
    })();

    const rivalPosBtns = document
        .querySelectorAll('.gk-overview-positions-btns-container .gk-overview-action-btn');

    rivalPosBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Position jetzt stabil aus data-Attribut lesen (robust gegen innerHTML-Änderungen)
            currentRivalPos = btn.dataset.pos; // 'ra', 'km' …

            // UI-Highlight konsistent setzen
            rivalPosBtns.forEach(b => b.classList.toggle('active-pos', b === btn));

            enableRivalActionBtns(true);
        });
    });

    /* Action-Buttons */
    on('undo-btn-rival', 'click', undoLastRivalShot);

    /* GK-Toggle (Rival) */
    const rivalToggle = document.querySelector('.gk-overview-toggle-btn');
    if (rivalToggle) {
        rivalToggle.addEventListener('click', async () => {
            currentRivalGoalkeeper = currentRivalGoalkeeper === 1 ? 2 : 1;
            updateRivalGoalkeeperButton();
            resetRivalProcess();
            renderRivalShotTable();
            renderRivalGKStatTable();
            try {
                await setCurrentRivalGoalkeeper(currentRivalGoalkeeper);
            } catch (e) {
                console.warn('[RIVAL-GK] persist failed', e);
            }
            updateRivalUndoState();
        });
    }

    // --- 7m-Flow-Buttons ---
    bindSevenMButtons();

}

/* ===================================================================
 * RIVAL : Shot fertigstellen
 * ===================================================================*/
/** Schließt einen Rival-Wurf ab, persistiert (IDB) und aktualisiert Tabellen. */
async function finishRivalShot(isSave) {
    if (!currentRivalPos) { // keine Pos. gewählt
        showToast('Erst eine Wurfposition wählen!', 'offline');
        return;
    }

    // HZ für Rival-Shot identisch bestimmen (DRY-Helper)
    const halfAtShot = computeHalfAtNow();

    const shot = {
        timestamp: new Date().toISOString(),
        gameTime: formatTime(gameSeconds),
        gameMinutesFloor: Math.floor(gameSeconds / 60),
        gameSeconds,
        shotCategory: currentRivalPos, // z.B. 'ra'
        isGoalkeeperSave: isSave,
        goalkeeperId: currentRivalGoalkeeper,
        team: 'rival',
        half: halfAtShot
    };

    /* sofort persistieren, falls online */
    try {
        shot.id = await addShot(shot); // IndexedDB
    } catch (e) {
        console.warn('[SHOT] IDB write failed', e);
    }

    shots.push(shot); // in globales Array

    renderRivalShotTable();
    renderRivalGKStatTable();
    resetRivalProcess();
}

/** Setzt den Rival-Erfassungsworkflow zurück (keine Pos. ausgewählt, Buttons aus). */
function resetRivalProcess() {
    currentRivalPos = null;
    enableRivalActionBtns(false);
    document
        .querySelectorAll('.gk-overview-action-btn')
        .forEach(b => b.classList.remove('active-pos'));
    updateRivalUndoState();
}

/** Macht den letzten Wurf des aktuell gewählten Rival-Keepers rückgängig (RAM + IDB). */
function undoLastRivalShot() {
    // suchen den letzten rival shot
    let i = shots.length - 1;
    while (i >= 0 && !(shots[i].team === 'rival' && (shots[i].goalkeeperId ?? 1) === currentRivalGoalkeeper)) i--;
    if (i < 0) {
        showToast('Kein Eintrag zum Rückgängigmachen', 'offline');
        return;
    }

    const last = shots.splice(i, 1)[0];
    if (last.id) deleteShot(last.id).catch(() => console.warn('[RIVAL] DB-Undo fehlgeschlagen'));

    renderRivalShotTable();
    renderRivalGKStatTable();
    showToast('Letzter Rival-Shot zurückgenommen', 'update');
    updateRivalUndoState();
}

/**
 * Baut die Rival-Verlaufstabelle (letzte Aktionen gegen den gegnerischen Keeper).
 * Farblogik:
 *  – s.isGoalkeeperSave === true für uns schlecht (Gegner pariert) rot (shot-row--goal)
 *  – s.isGoalkeeperSave === false für uns gut (Tor erzielt) grün (shot-row--save)
 */
function renderRivalShotTable() {
    const cont = document.getElementById('gk-overview-rival-table');
    if (!cont) return;

    // Nur Shots des aktuell gewählten Rival-Keepers, neueste zuerst
    const rows = shots
        .filter(s => s.team === 'rival' && (s.goalkeeperId ?? 1) === currentRivalGoalkeeper)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Tabelle neu aufbauen
    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'shot-table';
    tbl.innerHTML = `
      <thead>
        <tr><th>#</th><th>Min</th><th>Shot A</th><th>Goal A</th></tr>
      </thead>
      <tbody></tbody>`;
    cont.appendChild(tbl);

    const tb = tbl.querySelector('tbody');

    rows.forEach((s, i) => {
        const tr = document.createElement('tr');

        // Farblogik vereinheitlichen:
        // Parade (P) = GRÜN - shot-row--save
        // Tor (T) = ROT - shot-row--goal
        // Gilt hier bewusst auch für den Rivalen, damit UI konsistent bleibt.
        tr.className = s.isGoalkeeperSave ? 'shot-row--save' : 'shot-row--goal';

        // Kategorie-Kürzel:
        // - "7m" konsistent kleinschreiben
        // - alles andere in Großbuchstaben
        const rawCat = s.shotCategory ?? '';
        const cat = (typeof rawCat === 'string' && rawCat.toLowerCase() === '7m')
            ? '7m'
            : String(rawCat).toUpperCase();

        tr.innerHTML = `
          <td>${rows.length - i}</td>
          <td>${Math.ceil((s.gameSeconds || 0) / 60)}'</td>
          <td>${cat}</td>
          <td>${s.isGoalkeeperSave ? '–' : 'Tor'}</td>`;
        tb.appendChild(tr);
    });

    // Leerzustand
    if (!rows.length) {
        tb.innerHTML = `<tr><td colspan="4" style="padding:8px;">No shots yet …</td></tr>`;
    }

    updateRivalUndoState();
}

/* ===================================================================
 * Radiales Schnellmenü für die W-Zelle (Shot-Position bearbeiten)
 * ===================================================================*/
/* Optionen für das Radial-Menü – die Reihenfolge bestimmt die Position am Ring.
   Start ist 12 Uhr (oben), dann im Uhrzeigersinn. */
const SHOT_OPTION_DEFS = [
    {key: 'gs', label: 'GS'},
    {key: 'km', label: 'KM'},
    {key: 'dl', label: 'DL'},
    {key: 'dm', label: 'DM'},
    {key: 'dr', label: 'DR'},
    {key: 'ra', label: 'RA'},
    {key: 'la', label: 'LA'},
    {key: 'rr', label: 'RR'},
    {key: 'rm', label: 'RM'},
    {key: 'rl', label: 'RL'},
    {key: '7m', label: '7m'}
];

// einmaliges Anlegen des Overlays
function ensureShotRadialMenu() {
    if (document.getElementById('shot-radial-menu')) return;
    const el = document.createElement('div');
    el.id = 'shot-radial-menu';
    el.className = 'shot-radial';
    el.setAttribute('hidden', 'true');

    el.innerHTML = `
      <div class="shot-radial__core" aria-hidden="true">W</div>
      <div class="shot-radial__ring"></div>
    `;
    document.body.appendChild(el);
}

// Delegation – Klick auf Button in W-Zelle öffnet Menü
function bindShotTableRadial() {
    const container = document.getElementById('shot-table-container');
    if (!container || container.dataset.radialBound) return;

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.shot-edit-btn');
        if (!btn) return;

        const tr = btn.closest('tr');
        const shotKey = tr?.dataset.shotKey;
        if (!shotKey) return;
        openShotRadialFor(shotKey, btn);
    });
    container.dataset.radialBound = '1';
}

// Öffnen/Positionieren + Buttons setzen
function openShotRadialFor(shotKey, anchorEl) {
    // —Robustheit — ohne Menü/Anker kein Öffnen möglich
    const menu = document.getElementById('shot-radial-menu');
    if (!menu || !anchorEl) return;

    // — stabilen Schlüssel (id oder localId) am Overlay hinterlegen
    menu.dataset.shotKey = String(shotKey);

    // — Mittelpunkt relativ zur W-Zelle (der Button in der Spalte „W“)
    const r = anchorEl.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);

    // — Container für die radialen Optionen
    const ring = menu.querySelector('.shot-radial__ring');
    if (!ring) return;

    // — vorhandene Optionen neu aufbauen
    ring.innerHTML = '';
    const btns = SHOT_OPTION_DEFS.map(def => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'shot-radial__opt';
        b.textContent = def.label;
        b.dataset.key = def.key;
        b.setAttribute('aria-label', `Wurfposition ${def.label} wählen`);
        ring.appendChild(b);
        return b;
    });

    // — gleichmäßige Winkel (Start 12 Uhr, Uhrzeigersinn)
    const n = Math.max(1, btns.length);
    const stepDeg = 360 / n;
    const startDeg = -90;
    const stepRad = (Math.PI / 180) * stepDeg;

    // — dynamischer Radius, damit Buttons sich nicht berühren
    const sampleSize = btns[0]?.offsetWidth || 40;
    const minGap = 6;
    const minR = (sampleSize + minGap) / (2 * Math.sin(stepRad / 2) || 1);
    const baseR = 80;
    const R = Math.max(baseR, Math.ceil(minR));

    btns.forEach((btn, i) => {
        const angleRad = (Math.PI / 180) * (startDeg + i * stepDeg);
        const x = Math.round(Math.cos(angleRad) * R);
        const y = Math.round(Math.sin(angleRad) * R);
        btn.style.transform = `translate(${x}px, ${y}px)`;
    });

    // — Menü an den Anker positionieren (zentriert)
    menu.style.left = `${cx}px`;
    menu.style.top = `${cy}px`;

    // — Anzeigen und Schließen via Outside/ESC aktivieren
    menu.removeAttribute('hidden');
    menu.classList.add('is-open');

    setTimeout(() => {
        document.addEventListener('click', shotRadialDocClose, {capture: true, once: true});
        document.addEventListener('keydown', shotRadialEscClose, {once: true});
    }, 0);
}

function closeShotRadial() {
    const menu = document.getElementById('shot-radial-menu');
    if (!menu) return;
    // ausblend-Animation – erst Klasse entfernen, danach hidden setzen
    menu.classList.remove('is-open');
    // kleines Timeout, damit die CSS-Transition sichtbar ist
    setTimeout(() => menu.setAttribute('hidden', 'true'), 120);
}

function shotRadialDocClose(ev) {
    if (ev.target.closest('#shot-radial-menu')) return;
    closeShotRadial();
}

function shotRadialEscClose(ev) {
    if (ev.key === 'Escape') closeShotRadial();
}

// Einmaliger Click-Handler fürs Overlay – Anwendung + Persist-Update
function bindShotRadialApply() {
    const menu = document.getElementById('shot-radial-menu');
    if (!menu || menu.dataset.bound) return; // bereits gebunden oder nicht vorhanden → raus

    menu.addEventListener('click', async (e) => {
        // 1) Herausfinden, ob auf eine Option im Ring geklickt wurde
        const opt = e.target.closest('.shot-radial__opt');
        if (!opt) return;

        // 2) Gewählte Wurfkategorie (Kurzschlüssel), z. B. 'km', '7m', 'gs' …
        const key = opt.dataset.key;

        // 3) Stabilen Schlüssel (id oder localId) vom Menü lesen
        // dieser wurde zuvor in openShotRadialFor(..) gesetzt.
        const shotKey = menu.dataset.shotKey;
        if (!shotKey) {
            // Defensive: Falls kein Schlüssel vorhanden, menü schließen und abbrechen
            closeShotRadial();
            return;
        }

        // 4) Den passenden Shot in-memory finden (id ODER localId)
        const i = shots.findIndex(s => String(s.id ?? s.localId) === String(shotKey));
        if (i < 0) {
            // Nichts gefunden → Menü schließen und abbrechen
            closeShotRadial();
            return;
        }

        const old = shots[i];

        // 5) Neue Area-ID anhand Namens-Match (shotAreas) bestimmen
        //    Normalisierung (normalize) sorgt für robustes Matching (Legacy-Bezeichnungen).
        let newAreaId = old.shotAreaId;
        const match = shotAreas.find(a => normalize(a.name) === key);

        if (match) {
            newAreaId = match.id;
        } else if (key === 'gs' || key === '7m') {
            newAreaId = undefined;
        }

        // 6) Patch-Objekt: wir schreiben die UI-Kürzel bewusst in Großschrift
        const patch = {
            shotCategory: key.toUpperCase(),
            shotAreaId: newAreaId
        };

        try {
            if (old.id) {
                // 7a) Persistenter Datensatz (hat id): regulär via IndexedDB updaten
                const updated = await updateShot(old.id, patch);

                // In-Memory 1:1 ersetzen
                shots.splice(i, 1, updated);
            } else {
                // 7b) Offline-Datensatz (ohne id): direkt im RAM patchen
                // die spätere Synchronisation (bulkAddShots) nimmt diese Werte mit hoch.
                shots[i] = {...old, ...patch};
            }

            // 8) UI-Refresh (nur eigene Sichten nötig)
            updateStatistics();
            renderShotTable();
            renderGkOverviewTable();
            renderGKStatTable();
            drawAreas();

            // 9) Feedback: finaler Kategorie-Text aus dem (ggf. geupdateten) Objekt
            const label = shots[i].shotCategory || key.toUpperCase();
            showToast(`Wurfposition → ${label}`, 'update');
        } catch (err) {
            // Persistenzfehler (z. B. IndexedDB-Problem)
            console.error('[Radial-Update] Fehler beim Speichern:', err);
            showToast('Konnte Änderung nicht speichern', 'offline');
        } finally {
            // 10) Menü in jedem Fall schließen
            closeShotRadial();
        }
    });

    // Markieren, dass der Handler gebunden ist (Schutz vor Doppelbindung)
    menu.dataset.bound = '1';
}

// == 6. Area-Editor-Setup ==============================================
/**
 * Einfache Editor-View für Shot- und Goal-Areas (Listen + JSON-Form).
 * DB-Speichern erfolgt erst über den separaten „Save Areas“-Button.
 */
function initAreaEditors() {
    const root = document.getElementById('areas-editor-content');
    if (!root) return;

    if (!document.getElementById('shot-areas-editor')) {
        root.innerHTML = `
            <div class="editor-lists">
                <div id="shot-areas-editor" class="area-list"></div>
                <div id="goal-areas-editor" class="area-list"></div>
            </div>
            <div class="editor-actions">
                <button id="save-areas-btn" class="btn-primary">Save Areas</button>
            </div>
            <form id="area-edit-form" class="editor-form" style="display:none;">
                <input id="area-name-input" placeholder="Name">
                <input id="area-color-input" placeholder="Farbe (Hex)">
                <textarea id="area-coords-input" rows="5" placeholder="Koordinaten JSON"></textarea>
                <div class="form-buttons">
                    <button type="button" id="area-save-btn">Save</button>
                    <button type="button" id="area-cancel-btn">Cancel</button>
                </div>
            </form>
        `;
    }

    // Funktion zum Rendern der Listen (Shot- und Goal-Areas)
    function renderLists() {
        ['shot', 'goal'].forEach(type => {
            const container = document.getElementById(`${type}-areas-editor`);
            const arr = type === 'shot' ? shotAreas : goalAreas;
            container.innerHTML = '';
            const ul = document.createElement('ul');
            arr.forEach(area => {
                const li = document.createElement('li');
                li.textContent = area.name;

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Edit';
                editBtn.onclick = () => openEditForm(area, type);

                const delBtn = document.createElement('button');
                delBtn.textContent = '✕';
                delBtn.onclick = () => deleteArea(area.id, type);

                li.append(' ', editBtn, ' ', delBtn);
                ul.appendChild(li);
            });
            container.appendChild(ul);
        });
    }

    // Speichern der Areas-Daten in IndexedDB
    on('save-areas-btn', 'click', async () => {
        await setAreas(shotAreas, goalAreas);
        shotAreaMap = new Map(shotAreas.map(a => [a.id, a]));
        goalAreaMap = new Map(goalAreas.map(g => [g.id, g]));
        showToast('Areas gespeichert', 'update');
    });

    let editArea = null, editType = null;

    function openEditForm(area, type) {
        editArea = {...area};
        editType = type;
        const form = document.getElementById('area-edit-form');
        form.style.display = 'block';
        form.querySelector('#area-name-input').value = area.name;
        form.querySelector('#area-color-input').value = area.color;
        form.querySelector('#area-coords-input').value = JSON.stringify(area.coords, null, 2);
    }

    on('area-cancel-btn', 'click', () => {
        document.getElementById('area-edit-form').style.display = 'none';
    });

    on('area-save-btn', () => {
        const form = document.getElementById('area-edit-form');
        let coords;
        try {
            coords = JSON.parse(form.querySelector('#area-coords-input').value);
        } catch {
            alert('Koordinaten kein gültiges JSON');
            return;
        }
        editArea.name = form.querySelector('#area-name-input').value || editArea.name;
        editArea.color = form.querySelector('#area-color-input').value || editArea.color;
        editArea.coords = coords;

        const arr = editType === 'shot' ? shotAreas : goalAreas;
        const idx = arr.findIndex(a => a.id === editArea.id);
        if (idx > -1) arr[idx] = editArea;

        if (editType === 'shot') {
            shotAreaMap.set(editArea.id, editArea); // Den bestehenden Verweis überschreiben
        } else {
            goalAreaMap.set(editArea.id, editArea);
        }

        form.style.display = 'none';
        renderLists();
        drawAreas();
        showToast('Area aktualisiert – DB-Speicher nicht vergessen', 'update');
    });

    function deleteArea(id, type) {
        if (!confirm('Diese Area wirklich löschen?')) return;
        const arr = type === 'shot' ? shotAreas : goalAreas;
        const idx = arr.findIndex(a => a.id === id);
        if (idx > -1) arr.splice(idx, 1);
        if (type === 'shot') {
            shotAreaMap.delete(id);
        } else {
            goalAreaMap.delete(id);
        }
        renderLists();
        drawAreas();
        showToast('Area gelöscht – DB-Speicher nicht vergessen', 'update');
    }

    renderLists();
}

/* --------------------------------------------------------------
 Shot-Tabelle (rechte Spalte) – erzeugt/aktualisiert die Tabelle
----------------------------------------------------------------*/
function makeEmptyStatRow(goalkeeperName, halfLabel = '') {
    const row = document.createElement('tr');
    for (let col = 0; col < COLS; col++) {
        const td = document.createElement('td');
        row.appendChild(td);
    }
    row.children[0].textContent = goalkeeperName;
    row.children[1].textContent = halfLabel;

    /* Trennspalte visuell markieren (nutzt DIVIDER_IDX) */
    if (typeof DIVIDER_IDX === 'number' && row.children[DIVIDER_IDX]) {
        row.children[DIVIDER_IDX].classList.add('is-divider');
        // row.children[DIVIDER_IDX].textContent = ''; // bewusst leer lassen
    }

    return row;
}

/** Kleine Verlaufstabelle (rechte Spalte) für den eigenen, aktiven Keeper. */
function renderShotTable() {
    const cont = document.getElementById('shot-table-container');
    if (!cont) return;

    const rows = shots
        .filter(s => s.team !== 'rival' && (s.goalkeeperId ?? 1) === currentGoalkeeper)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'shot-table';
    tbl.innerHTML = `
    <thead>
      <tr><th>#</th><th>m</th><th>W</th><th>T</th></tr>
    </thead>
    <tbody></tbody>`;
    cont.appendChild(tbl);

    const tbody = tbl.querySelector('tbody');

    rows.forEach((s, idx) => {
        const isSevenMShot =
            normalize(s.shotCategory ?? (shotAreaMap.get(s.shotAreaId)?.name ?? '')) === '7m';

        const isGsShot =
            normalize(s.shotCategory ?? (shotAreaMap.get(s.shotAreaId)?.name ?? '')) === 'gs';

        // Bei 7m immer „7m“ zeigen; bei GS „GS“; sonst Area-Name oder „–“
        const shotName = isSevenMShot
            ? '7m'
            : (isGsShot ? 'GS' : (shotAreaMap.get(s.shotAreaId)?.name ?? '–'));

        let rawGoal = goalAreaMap.get(s.goalAreaId)?.name ?? '–';
        if (isSevenMShot) {
            rawGoal = s.goalAreaId != null ? (goalAreaMap.get(s.goalAreaId)?.name ?? '–') : '7m';
        }

        // 7m-Spezialfall: In der Tabelle KEIN Tor-Sektor anzeigen,
        // sondern nur das Ergebnis – "TOR" (bei Gegentor) oder "–" (bei Parade).
        // Hintergrund: Bei 7m ist die genaue Platzierung optional/irrelevant für diese Ansicht.
        const goalLabel = isSevenMShot
            ? (s.isGoalkeeperSave ? '–' : 'TOR')
            : mirrorGoalSector(rawGoal);

        const min = Math.ceil((s.gameSeconds || 0) / 60);


        const tr = document.createElement('tr');
        tr.className = s.isGoalkeeperSave ? 'shot-row--save' : 'shot-row--goal';

        /* Stabiler Schlüssel: id oder (offline) localId */
        tr.dataset.shotKey = ensureLocalKey(s); // ← ersetzt tr.dataset.shotId

        tr.innerHTML = `
          <td>${rows.length - idx}</td>
          <td>${min}'</td>
          <td class="shot-td--cat"><button type="button" class="shot-edit-btn">${shotName}</button></td>
          <td>${goalLabel}</td>`;

        tbody.appendChild(tr);
    });

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:8px;">No shots yet …</td></tr>`;
    }
}

/**
 * Übersichtstabelle für eigene Würfe inkl. laufender Quote.
 * Hinweis: Der Container '#gk-overview-own-table' ist aktuell nicht im DOM;
 * die Funktion beendet sich dann ohne Wirkung (vorgesehen für künftige Nutzung).
 */
function renderGkOverviewTable() {
    const cont = document.getElementById('gk-overview-own-table');
    if (!cont) return;

    const rows = shots
        .filter(s => s.team !== 'rival' && (s.goalkeeperId ?? 1) === currentGoalkeeper)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'shot-table';
    tbl.innerHTML = `
    <thead>
      <tr><th>#</th><th>m</th><th>W</th><th>%</th></tr>
    </thead>
    <tbody></tbody>`;
    cont.appendChild(tbl);

    const tbody = tbl.querySelector('tbody');
    if (!rows.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.style.padding = '8px';
        td.textContent = 'No shots yet …';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    let saves = 0, total = 0;
    rows.forEach((s, idx) => {
        total++;
        if (s.isGoalkeeperSave) saves++;
        const tr = document.createElement('tr');
        tr.className = s.isGoalkeeperSave ? 'shot-row--save' : 'shot-row--goal';

        const c1 = document.createElement('td');
        c1.textContent = String(idx + 1);
        const c2 = document.createElement('td');
        c2.textContent = `${Math.ceil((s.gameSeconds || 0) / 60)}'`;
        const c3 = document.createElement('td');
        c3.textContent = shotAreaMap.get(s.shotAreaId)?.name ?? '–';
        const c4 = document.createElement('td');
        c4.textContent = Math.round((saves / total) * 100) + '%';

        tr.append(c1, c2, c3, c4);
        tbody.appendChild(tr);
    });
}

// == 7. Canvas-Interaktion ==============================================
/**
 * Behandelt einen Klick auf das Spielfeld-Canvas.
 *
 * Logik ohne Step-Indicator:
 * ‒ Wenn noch keine Wurfposition gewählt wurde ⇒ erster Klick
 * ‒ sonst – sofern noch keine Torposition gewählt wurde ⇒ zweiter Klick
 * ‒ alle Prüfungen laufen über das Vorhandensein der beiden
 * State-Variablen `currentShotPosition` und `currentExactGoalPos`.
 * Sonderfall „7m“: zweiter Klick entfällt; es wird eine Dummy-Goal-Area verwendet.
 *
 * @param {MouseEvent} e – Maus-/Touch-Event
 */
// Einheitlicher Canvas-Klick-Handler (2-Schritt-Workflow)
function handleCanvasClick(e) {
    // 7m-Flow hat Vorrang – verarbeitet und beendet den Klick ggf. vollständig
    if (handleCanvasClickForSevenM(e)) return;

    const {relX, relY} = getRelCoords(e);

    /* ---------- 1) Erster Klick - Wurf-Position festlegen ---------- */
    if (!currentShotPosition) {
        // 1a) Gegenstoß zuerst prüfen (virtueller Bereich, kein DB-Eintrag)
        if (pointInGsSector(relX, relY)) {
            paintTempMarker(relX, relY); // gelber Temp-Marker am Klickpunkt
            currentShotPosition = {id: undefined, name: 'GS', __virtualGS: true}; // nur Label
            currentExactShotPos = {x: relX, y: relY};
            currentStep = 2; // jetzt Tor-Sektor wählen
            updateButtonStates();
            drawAreas();
            return;
        }

        // 1b) Normale Shot-Area auf dem Feld ermitteln (Legacy-Polygon oder Rechteck)
        const shotArea = findShotAreaAtPoint(relX, relY, shotAreas);
        if (!shotArea) return; // außerhalb geklickt → ignorieren

        paintTempMarker(relX, relY); // gelber Temp-Marker
        currentShotPosition = shotArea; // echte Shot-Area übernehmen
        currentExactShotPos = {x: relX, y: relY};
        currentStep = 2; // jetzt Tor-Sektor wählen
        updateButtonStates();
        drawAreas();
        return;
    }

    /* ---------- 2) Zweiter Klick ⇒ Tor-Sektor festlegen ------------ */
    if (!currentExactGoalPos) {
        // WICHTIG – Goal-Area bestimmen (inkl. Mini-Tor-Mapping), nicht erneut eine Shot-Area!
        const goalArea = getClickedGoalArea(relX, relY);
        if (!goalArea) {
            showToast('Bitte einen Tor-Sektor treffen', 'offline');
            return;
        }

        paintTempMarker(relX, relY); // gelber Temp-Marker am Tor-Sektor
        currentExactGoalPos = {x: relX, y: relY};
        currentGoalArea = goalArea; // Caching des konkreten Tor-Sektors
        updateButtonStates(); // Tor/Gehalten aktivieren
        drawAreas();
    }
}

// == 8. Workflow-Steuerung =============================================
/**
 * Aktualisiert die Overlay-Buttons:
 * – Tor/Gehalten aktiv, wenn Shot- und Goal-Position gesetzt sind (Step 2).
 * – Abbrechen aktiv, sobald eine "Shot-Position" gewählt wurde (Step begonnen).
 * – Undo nur, wenn es eigene Shots für den aktuell gewählten Keeper gibt
 * und kein laufender Erfassungsschritt aktiv ist.
 */
function updateButtonStates() {

    // Für 7m soll das Ergebnis (Tor/Gehalten) auch OHNE gewählten Tor-Sektor möglich sein.
    // Buttons aktivieren, sobald Schritt 2 erreicht UND (entweder 7m aktiv ODER bereits ein Torpunkt gewählt).
    const isSevenMActive =
        !!currentShotPosition && normalize(currentShotPosition.name ?? '') === '7m';
    const stepReady = currentStep === 2 && (isSevenMActive || !!currentExactGoalPos);

    const goalBtn = document.getElementById('goal-btn');
    if (goalBtn) goalBtn.classList.toggle('active', stepReady);

    const saveBtn = document.getElementById('goalkeeper-save-btn');
    if (saveBtn) saveBtn.classList.toggle('active', stepReady);

    const cancelPossible = !!currentShotPosition;
    const cancelBtn = document.getElementById('cancel-btn');
    if (cancelBtn) cancelBtn.classList.toggle('active', cancelPossible);

    // Undo nur, wenn es für den *aktuellen* Keeper eigene Shots gibt
    const hasOwnShotsForGK = shots.some(
        s => s.team !== 'rival' && (s.goalkeeperId ?? 1) === currentGoalkeeper
    );
    const undoReady = hasOwnShotsForGK && !currentShotPosition && currentStep === 1;

    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.classList.toggle('active', undoReady);
        undoBtn.disabled = !undoReady;
    }
    // 7m-Overlay-Button sperren, sobald ein Erfassungsschritt aktiv ist
    const btn7 = document.getElementById(SEVENM_BTN_ID);
    if (btn7) btn7.disabled = !!currentShotPosition;
}

function resetRegistrationProcess() {
    currentStep = 1; // interner State
    currentShotPosition = null;
    currentExactShotPos = null;
    currentExactGoalPos = null;
    currentGoalArea = null;
    updateButtonStates();
    drawAreas();
}

/**
 * Persistiert den komplett erfassten Wurf (inkl. exakter Koordinaten),
 * aktualisiert Statistiken/Tabellen und setzt den Workflow zurück.
 * Behandelt „7m“ als Dummy-Goal-Area, falls keine echte Torzone getroffen wurde.
 * @param {boolean} gkSave true = Parade, false = Tor
 */
async function finishShot(gkSave = false) {
    const isSevenM =
        !!currentShotPosition && normalize(currentShotPosition.name ?? '') === '7m';

    if (!currentShotPosition || (!isSevenM && !currentExactShotPos)) {
        showToast('Ungültiger Wurf – bitte alle Schritte abschließen', 'offline');
        return;
    }

    // Primär die *bereits gewählte* Tor-Zone verwenden (stabil gegen Resize/Zoom).
    let goalArea = currentGoalArea;

    /* Sicherheitsnetz – falls im Cache versehentlich eine Shot-Area liegt
   (altes Fehlverhalten), ermitteln wir hier die *echte* Goal-Area erneut. */
    if (goalArea && !goalAreaMap.has(goalArea.id)) {
        const ref = currentExactGoalPos ?? currentExactShotPos;
        goalArea = ref ? getClickedGoalArea(ref.x, ref.y) : null;
    }

    // Bestmögliche Ermittlung (nur wenn Koordinaten vorhanden),
    // ansonsten – für zulässig – ohne Tor-Sektor fortfahren.
    if (!goalArea) {
        const goalRef = currentExactGoalPos ?? currentExactShotPos;
        if (goalRef && goalRef.x != null && goalRef.y != null) {
            goalArea = getClickedGoalArea(goalRef.x, goalRef.y);
        }
    }
    // Für Nicht-7m bleibt die Tor-Sektor-Pflicht bestehen.
    if (!goalArea && !isSevenM) return;

    const halfAtShot = computeHalfAtNow();

    const shot = {
        timestamp: new Date().toISOString(),
        gameTime: formatTime(gameSeconds),
        gameMinutesFloor: Math.floor(gameSeconds / 60),
        gameSeconds,
        shotAreaId: isSevenM ? undefined : currentShotPosition.id,
        goalAreaId: goalArea ? goalArea.id : undefined,
        shotCategory: currentShotPosition.name,
        exactShotPos: isSevenM ? SEVEN_M_THROW_POINT : currentExactShotPos, // 7m: null-Koordinaten
        exactGoalPos: isSevenM ? (currentExactGoalPos || null) : currentExactGoalPos,
        isGoalkeeperSave: gkSave,
        goalkeeperId: currentGoalkeeper,
        half: halfAtShot // stabile HZ im Datensatz hinterlegen
    };

    try {
        shot.id = await addShot(shot);
    } catch (e) {
        console.warn('[SHOT] IDB write failed', e);
    }

    shots.push(shot);

    updateStatistics();
    renderShotTable();
    renderGkOverviewTable();
    renderGKStatTable();
    resetRegistrationProcess();

    // Live-Score nur bei Gegentor gegen uns (keine Rival-Shots)
    if (!gkSave && (shot.team !== 'rival')) {
        await updateLiveScore();
    }
}

// == 9. Zeichnen & Statistik ===========================================
/** Zeichnet eine rechteckige Zone (Füllung/Kontur separat alpha-gesteuert) inkl. Label. */
function drawRectArea(ctx, area, w, h, fillAlpha = ALPHA_SHOT_RECT, strokeAlpha = ALPHA_STROKE_SHOT_RECT) {
    const {x1, y1, x2, y2} = area.coords;
    const px = x1 * w, py = y1 * h, pw = (x2 - x1) * w, ph = (y2 - y1) * h;

    ctx.save();

    // --- Füllung halbtransparent ------------------------------------
    ctx.globalAlpha = fillAlpha; // ← Füll-Transparenz
    ctx.fillStyle = area.color;
    ctx.fillRect(px, py, pw, ph);

    // --- Kontur separat steuern -------------------------------------
    ctx.globalAlpha = strokeAlpha; // ← Kontur-Transparenz
    ctx.strokeStyle = area.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // --- Label/Text deckend -----------------------------------------
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(area.name, (x1 + x2) / 2 * w, (y1 + y2) / 2 * h);

    ctx.restore();
}

/** Zeichnet – falls vorhanden – einen temporären Marker (Work-in-Progress). */
function drawTempMarkerIfAvailable(pos) {
    if (!pos) return;
    const p = relToCanvas(pos.x, pos.y, canvas);
    drawMarker(ctx, p.x, p.y, 6, COLOR_TEMP_MARKER);
}

/**
 * Komplettes Redraw auf Basis der aktuellen Canvas-Größe:
 * 1) Wurfzonen (Legacy-Polygon vs. Rechteck)
 * 2) Torzonen
 * 3) Optionale Verbindungslinien (nur eigene Shots des aktiven Keepers)
 * 4) Permanente Marker + Minutenlabels
 * 5) Temporäre Marker (laufender Erfassungsschritt)
 */
function drawAreas() {
    if (!canvas || !ctx) return;

    // Immer die *aktuellen* Canvas-Maße nutzen, um Pixel vs. Relativwerte konsistent zu halten
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1) Shot-Areas: Legacy-Polygon (id ≤ 9) vs. Rechteck (id ≥ 10)
    // Transparenzen für Füllung/Kontur getrennt steuerbar (visuell ruhiger)
    shotAreas.forEach(area => {
        if (area.id <= 9) {
            drawShotAreaLegacy(
                ctx, area, canvasWidth, canvasHeight,
                ALPHA_SHOT_LEGACY, ALPHA_STROKE_SHOT_LEGACY
            );
        } else {
            drawRectArea(
                ctx, area, canvasWidth, canvasHeight,
                ALPHA_SHOT_RECT, ALPHA_STROKE_SHOT_RECT
            );
        }
    });

    // 2) Goal-Areas (immer Rechtecke) – ebenfalls Fill+Stroke getrennt
    goalAreas.forEach(area => {
        const x1 = area.coords.x1 * canvasWidth;
        const y1 = area.coords.y1 * canvasHeight;
        const x2 = area.coords.x2 * canvasWidth;
        const y2 = area.coords.y2 * canvasHeight;
        const w = x2 - x1, h = y2 - y1;

        ctx.save();
        ctx.globalAlpha = ALPHA_GOAL_AREAS;
        ctx.fillStyle = area.color;
        ctx.fillRect(x1, y1, w, h);

        ctx.globalAlpha = ALPHA_STROKE_GOAL_AREAS;
        ctx.strokeStyle = area.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, w, h);
        ctx.restore();
    });

    /* GS-Overlay immer zeichnen (auch ohne gespeicherte Shots) */
    drawGsOverlay(ctx);


    // 3) Nur Shots des aktiven Keepers visualisieren (klare Trennung eig./rival)
    const visibleShots = shots
        .filter(s => s.team !== 'rival' && (s.goalkeeperId ?? 1) === currentGoalkeeper);

    // Verbindungslinien optional (Replays/Analyse)
    if (showShotLines) {
        ctx.save();
        ctx.strokeStyle = COLOR_LINES;
        ctx.lineWidth = WIDTH_LINES;
        ctx.shadowBlur = BLUR_LINES;
        ctx.shadowColor = SHADOW_COLOR;

        visibleShots.forEach(s => {
            // Shots ohne exakte Koordinaten auslassen (ältere Datensätze)
            if (!s.exactShotPos || !s.exactGoalPos) return;
            const start = relToCanvas(s.exactShotPos.x, s.exactShotPos.y, canvas);
            const end = relToCanvas(s.exactGoalPos.x, s.exactGoalPos.y, canvas);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        });
        ctx.restore();
    }

    // 4) Permanente Marker + Minuten-Label
    visibleShots.forEach(s => {
        const col = s.isGoalkeeperSave ? COLOR_GOAL_SAVE : COLOR_GOAL_TOR;

        // 7m-Unterstützung: Trefferpunkt zeichnen, auch wenn kein Abwurfpunkt existiert
        const hasShot = !!(s.exactShotPos && s.exactShotPos.x != null && s.exactShotPos.y != null);
        const hasGoal = !!(s.exactGoalPos && s.exactGoalPos.x != null && s.exactGoalPos.y != null);

        if (!hasShot && !hasGoal) return;

        let shotPt, goalPt;

        if (hasShot) {
            shotPt = relToCanvas(s.exactShotPos.x, s.exactShotPos.y, canvas);
            drawMarker(ctx, shotPt.x, shotPt.y, 12, col);
        }
        if (hasGoal) {
            goalPt = relToCanvas(s.exactGoalPos.x, s.exactGoalPos.y, canvas);
            drawMarker(ctx, goalPt.x, goalPt.y, 8, col);
        }

        // Minutenlabel: bevorzugt am Abwurfpunkt, sonst am Trefferpunkt
        const labelPt = shotPt || goalPt;
        drawText(ctx, String(Math.ceil(s.gameSeconds / 60) || 0), labelPt.x, labelPt.y, '12px Arial', '#000');
    });

    // 5) Temp
    drawTempMarkerIfAvailable(currentExactShotPos);
    drawTempMarkerIfAvailable(currentExactGoalPos);

    // 6) Netz
    if (currentShotPosition &&
        normalize(currentShotPosition.name ?? '') === '7m' &&
        !currentExactGoalPos) {
        drawMiniGoalGrid(ctx);
    }

}

function drawMiniGoalGrid(ctx) {
    // --- Visuelle 3×3-Hilfslinien im 7m-Mini-Tor (nur während Schritt 2, bevor der Sektor gewählt ist)
    const {x1, y1, x2, y2} = MINI_GOAL_BBOX;
    const X1 = x1 * canvasWidth, X2 = x2 * canvasWidth;
    const Y1 = y1 * canvasHeight, Y2 = y2 * canvasHeight;
    const W = X2 - X1, H = Y2 - Y1;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;

    // Rahmen
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(X1, Y1, W, H);

    // 2 vertikale + 2 horizontale Teilungen → 3×3
    for (let i = 1; i <= 2; i++) {
        const vx = X1 + (W * i) / 3;
        const hy = Y1 + (H * i) / 3;
        ctx.beginPath();
        ctx.moveTo(vx, Y1);
        ctx.lineTo(vx, Y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(X1, hy);
        ctx.lineTo(X2, hy);
        ctx.stroke();
    }

    ctx.restore();
}

/* Allgemeine Polygon-Füllung mit Schraffur + gestrichelter Kontur */
function drawGsOverlay(ctx) {
    if (!ENABLE_GS_SECTOR || !canvas) return;

    // in Canvas-Pixel umrechnen
    const pts = GS_SECTOR_POLY.map(p => ({
        x: p.x * canvasWidth,
        y: p.y * canvasHeight
    }));

    // Füllung
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.globalAlpha = GS_STYLE.fillAlpha;
    ctx.fillStyle = GS_STYLE.fill;
    ctx.fill();

    // Schraffur (Clip auf das Polygon, dann Linien im gewünschten Winkel)
    ctx.clip();
    ctx.globalAlpha = GS_STYLE.hatchAlpha;
    ctx.strokeStyle = GS_STYLE.fill;
    ctx.lineWidth = 2;

    const ang = (Math.PI / 180) * GS_STYLE.hatchAngleDeg;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    // ausreichend großer „Kasten“ für die Schraffur
    const maxD = Math.hypot(canvasWidth, canvasHeight);
    for (let d = -maxD; d <= maxD; d += GS_STYLE.hatchStep) {
        // Linie in gedrehtem Koordinatensystem zeichnen
        const x1 = d * cosA - (-maxD) * sinA + canvasWidth / 2;
        const y1 = d * sinA + (-maxD) * cosA + canvasHeight / 2;
        const x2 = d * cosA - (maxD) * sinA + canvasWidth / 2;
        const y2 = d * sinA + (maxD) * cosA + canvasHeight / 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // gestrichelte Kontur
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.globalAlpha = GS_STYLE.strokeAlpha;
    ctx.strokeStyle = GS_STYLE.stroke;
    ctx.setLineDash(GS_STYLE.dash);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

/* Punkt-in-Polygon-Test für GS – nutzt bestehende Utility-Logik */
function pointInGsSector(relX, relY) {
    if (!ENABLE_GS_SECTOR) return false;
    const px = relX * canvasWidth;
    const py = relY * canvasHeight;
    const pts = GS_SECTOR_POLY.map(p => ({x: p.x * canvasWidth, y: p.y * canvasHeight}));
    return isPointInPolygon(pts, {x: px, y: py});
}

/**
 * Baut die beiden Stat-Box-Container (Shot-Positionen, Goal-Areas) neu auf.
 * Es zählen ausschließlich eigene Würfe des aktuell gewählten Keepers.
 * Fehlen die Container im DOM, wird frühzeitig beendet (defensiv).
 */
function updateStatistics() {
    /* ---- 1) Relevante Würfe für aktuellen Torwart vorfiltern ------ */
    const relevantShots = shots
        .filter(s => s.team !== 'rival' &&
            (s.goalkeeperId ?? 1) === currentGoalkeeper // Fallback=1
        );

    /* ---- 2) UI-Container für Shot- und Goal-Stats holen ----------- */
    const shotContainer = document.getElementById('shot-positions-stats');
    const goalContainer = document.getElementById('goal-areas-stats');

    // Falls Container nicht vorhanden – fehlerfreien return
    if (!shotContainer || !goalContainer) return;

    /* ---- 3) Leerer Zustand (kein einziger relevanter Schuss) ------- */
    if (!relevantShots.length) {
        shotContainer.innerHTML = '<div class="stat-box">Keine Schüsse vorhanden</div>';
        goalContainer.innerHTML = '';
        return;
    }

    /* ---- 4) Grunddaten für Prozentberechnung ---------------------- */
    const total = relevantShots.length;

    /* ---- 5) Shot-Positions (Wurfzonen) ----------------------------- */
    shotContainer.innerHTML = '';
    shotAreas.forEach(area => {
        const count = relevantShots.filter(s => s.shotAreaId === area.id).length;
        const pct = ((count / total) * 100).toFixed(1);
        shotContainer.appendChild(makeStatBox(area.name, count, pct));
    });

    /* ---- 6) Goal-Areas ------------------------------------------------ */
    goalContainer.innerHTML = '';
    goalAreas.forEach(area => {
        const count = relevantShots.filter(s => s.goalAreaId === area.id).length;
        const pct = ((count / total) * 100).toFixed(1);
        goalContainer.appendChild(makeStatBox(area.name, count, pct));
    });

    /* ---- stat-Box-Factory ------------------------------------------ */
    function makeStatBox(label, count, pct) {
        const div = document.createElement('div');
        div.className = 'stat-box';

        const a = document.createElement('div');
        a.className = 'stat-position';
        a.textContent = label;
        const b = document.createElement('div');
        b.className = 'stat-count';
        b.textContent = String(count);
        const c = document.createElement('div');
        c.className = 'stat-percent';
        c.textContent = `${pct}%`;

        div.append(a, b, c);
        return div;
    }
}

// == 10. Timer-Logik =====================================================
/** Stellt gespeicherten Timer-Zustand wieder her und startet ggf. die Uhr. */
async function initTimers() {
    const raw = await getGameTimerState();
    const state = raw ?? {seconds: 0, isRunning: false};

    gameSeconds = Number.isFinite(state.seconds) ? Number(state.seconds) : 0;
    gameRunning = !!state.isRunning;

    document.getElementById('game-time').textContent = formatTime(gameSeconds);
    document.getElementById('reset-btn').disabled = gameRunning;
    const startPauseBtn = document.getElementById('start-pause-btn');
    startPauseBtn.textContent = gameRunning ? 'Pause' : 'Start';

    if (gameRunning) {
        gameInterval = setInterval(updateGameTime, 1000);
    }
}

/** Start/Pause Umschalten, UI aktualisieren, Zustand persistent halten. */
function toggleGameTimer() {
    const btn = document.getElementById('start-pause-btn');

    if (gameRunning) {
        // --- Pause drücken ------------------------------------------------------
        clearInterval(gameInterval);
        btn.textContent = 'Fortsetzen';
    } else {
        // --- Start drücken ------------------------------------------------------
        // Wenn wir ab 30:00 neu starten und die 2. HZ noch nicht „aktiv“ ist,
        // wird sie hier scharf geschaltet (exakt nach Nutzer-Start).
        if (gameSeconds >= HALF_LENGTH && !secondHalfStarted) {
            secondHalfStarted = true;
            saveSecondHalfStarted();

            // UI nachziehen, da currentHalf() nun auf 2. HZ springen kann
            refreshHalfDependentUI();
        }

        gameInterval = setInterval(updateGameTime, 1000);
        btn.textContent = 'Pause';
    }

    gameRunning = !gameRunning;
    document.getElementById('reset-btn').disabled = gameRunning;

    setGameTimerState(gameSeconds, gameRunning)
        .catch(err => console.error('[Timer] setGameTimerState fehlgeschlagen:', err));
}

/**
 * Verschiebt die Spielzeit um `diff` Sekunden (geclamped 0…60 min) und speichert.
 * Halbzeitwechsel triggert ein UI-Refresh (Badges/Tabellen).
 */
function adjustGameSeconds(diff) {
    const prevHalf = currentHalf(); // vorherige HZ merken

    gameSeconds = Math.max(0, Math.min(FULL_LENGTH, gameSeconds + diff));
    document.getElementById('game-time').textContent = formatTime(gameSeconds);

    if (currentHalf() !== prevHalf) { // Halbzeit gewechselt?
        refreshHalfDependentUI();
    }

    setGameTimerState(gameSeconds, gameRunning) // speichern
        .catch(console.error);
}

/**
 * Tick-Handler im Laufbetrieb: Zeit hochzählen, Auto-Stops bei 30:00/60:00,
 * Halbzeit-/Ende-Aktionen (Auto-Fill), Zustand persistieren.
 */
async function updateGameTime() {
    /* 1) Zeit hochzählen & Anzeige aktualisieren */
    gameSeconds++;
    document.getElementById('game-time').textContent = formatTime(gameSeconds);

    /* 2) Auto-Stopps bei 30:00 (HZ) und 60:00 (Ende) */
    if (gameSeconds === HALF_LENGTH || gameSeconds === FULL_LENGTH) {

        /* — Timer anhalten & Zustand speichern — */
        toggleGameTimer(); // pausiert + speichert State

        /* === 30:00 min ⇒ Halbzeit-Aktionen ===================== */
        if (gameSeconds === HALF_LENGTH) {
            await autoFillHalftimeScore(); // Ergebnis automatisch eintragen

            refreshHalfDependentUI();
        }

        /* === 60:00 min ⇒ Ende-Aktionen ========================= */
        if (gameSeconds === FULL_LENGTH)
            await autoFillFulltimeScore(); // Endstand eintragen
    }

    /* 3) Fortschritt persistent speichern */
    if (gameRunning) {
        await setGameTimerState(gameSeconds, true).catch(console.error);
    }
}

/** Stoppt und nullt die Uhr (UI + Persistenz). */
function resetGameTimer() {
    clearInterval(gameInterval);
    gameSeconds = 0;
    gameRunning = false;
    document.getElementById('start-pause-btn').textContent = 'Start';
    document.getElementById('game-time').textContent = formatTime(0);
    document.getElementById('reset-btn').disabled = false;

    // --- 2. HZ-Flag zurücksetzen --------------------------------------------
    secondHalfStarted = false;
    saveSecondHalfStarted();
    refreshHalfDependentUI(); // Badges/Tabellen auf 1. HZ bringen

    // Zustand zurücksetzen
    setGameTimerState(0, false).catch(err =>
        console.error('[Timer] setGameTimerState fehlgeschlagen:', err)
    );
}

// Hilfsfunktion: Formatiert Sekundenwert in "m:ss"
const formatTime = sec =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// == 11. Online/Offline & DB Sync =======================================

/**
 * Online/Offline-Behandlung:
 * – Online: nicht synchronisierte Offline-Shots nachtragen, anschließend neu lesen.
 * – Render-Reihenfolge: erst eigene Sichten, dann Rival, zuletzt Canvas.
 * – Offline: klarer Toast, State bleibt valide.
 */
async function handleConnectionChange() {
    if (navigator.onLine) {
        // Falls ein Offline-Hinweis offen war - entfernen
        document.querySelector('.toast--offline')?.remove();

        // Nur Datensätze ohne ID sind "unsynced" (offline erfasst)
        const unsynced = shots.filter(s => s.id == null);

        if (unsynced.length) {
            try {
                await bulkAddShots(unsynced);
                shots = await getShots();
                updateStatistics();
                renderGkOverviewTable();
                renderGKStatTable();
                renderRivalShotTable();
                renderRivalGKStatTable();
                drawAreas();
                showToast('Offline-Daten synchronisiert ✓', 'update');
                updateButtonStates();
                enableRivalActionBtns(false);
                updateRivalUndoState();

            } catch (e) {
                console.warn('[SYNC] Bulk-Insert fehlgeschlagen', e);
                showToast('Sync fehlgeschlagen – erneut versuchen', 'offline');
            }
        }
    } else {
        showToast('Keine Internet-Verbindung', 'offline');
    }
}

function computeConcededUntil(limitSec) {
    const lim = Math.max(0, Math.min(FULL_LENGTH, Number(limitSec) || 0));

    const concededShots = shots.filter(s =>
        s.team !== 'rival' &&
        !s.isGoalkeeperSave &&
        ((s.gameSeconds ?? FULL_LENGTH) <= lim)
    ).length;

    const g1 = sevenG6[1] || {}, g2 = sevenG6[2] || {};
    const sevenFirst  = (g1[1] ?? 0) + (g2[1] ?? 0);
    const sevenSecond = (g1[2] ?? 0) + (g2[2] ?? 0);

    return lim <= HALF_LENGTH
        ? concededShots + sevenFirst
        : concededShots + sevenFirst + sevenSecond;
}

/**
 * Halbzeit-Stand (Gegentore bis 30:00) automatisch eintragen.
 * - Zählt Gegentore aus echten Shots + addiert 7g6 der 1. HZ.
 * - Wenn `force === false`: nur eintragen, falls das Feld leer ist.
 * - Wenn `force === true`: immer überschreiben (für Live-Updates).
 */
async function autoFillHalftimeScore(force = false) {
    // 1) Ziel-Input (falls vorhanden) ermitteln
    const htInput = document.getElementById('halftime-input');

    // 2) Darf aktualisiert werden?
    //    - force: immer
    //    - sonst: nur wenn kein Input existiert ODER das Feld leer ist
    const mayUpdate = force || !htInput || htInput.value.trim() === '';
    if (!mayUpdate) return;

    // 3) Wert robust berechnen (Shots + 7g6 der 1. HZ)
    const conceded = computeConcededUntil(HALF_LENGTH);

    // 4) Feld (falls vorhanden) beschreiben
    if (htInput) htInput.value = String(conceded);

    // 5) Persistieren (MatchInfo) und Anzeige aktualisieren
    try {
        await setMatchInfo('halftime', String(conceded));
    } catch (err) {
        console.error('[HT-AutoFill] Speichern fehlgeschlagen:', err);
    }

    await updateScoreDisplays();
}

/**
 * Endstand (Gegentore bis 60:00) automatisch eintragen.
 * - Zählt Gegentore aus echten Shots + addiert alle 7g6 (HZ 1 + 2).
 * - Wenn `force === false`: nur eintragen, falls das Feld leer ist.
 * - Wenn `force === true`: immer überschreiben (für Live-Updates).
 */
async function autoFillFulltimeScore(force = false) {
    // 1) Ziel-Input (falls vorhanden) ermitteln
    const ftInput = document.getElementById('fulltime-input');

    // 2) Darf aktualisiert werden?
    //    - force: immer
    //    - sonst: nur wenn kein Input existiert ODER das Feld leer ist
    const mayUpdate = force || !ftInput || ftInput.value.trim() === '';
    if (!mayUpdate) return;

    // 3) Wert robust berechnen (Shots + 7g6 HZ1+HZ2)
    const conceded = computeConcededUntil(FULL_LENGTH);

    // 4) Feld (falls vorhanden) beschreiben
    if (ftInput) ftInput.value = String(conceded);

    // 5) Persistieren (MatchInfo) und Anzeige aktualisieren
    try {
        await setMatchInfo('fulltime', String(conceded));
    } catch (err) {
        console.error('[FT-AutoFill] Speichern fehlgeschlagen:', err);
    }

    await updateScoreDisplays();
}

/**
 * Hilfsfunktion – HT/FT live nachziehen (mit force-Default).
 */
async function updateLiveScore(force = true) {
    if (currentHalf() === FIRST_HALF) {
        await autoFillHalftimeScore(force);
    } else {
        await autoFillFulltimeScore(force);
    }
}

/**
 * Liefert die erste passende Shot-Area zum relativen Punkt (relX, relY).
 * Legacy-IDs (≤9) werden über Polygon/Radius geprüft, sonst Rechteck-Hit.
 */
const findShotAreaAtPoint = (relX, relY, areas) =>
    areas.find(area => {
        if (area.id <= 9) {
            return isPointInShotAreaLegacy(
                area,
                relX * canvasWidth,
                relY * canvasHeight
            );
        }

        const c = area.coords;
        return relX >= c.x1 && relX <= c.x2 &&
            relY >= c.y1 && relY <= c.y2;
    });

/**
 * Liefert die erste passende Area (Polygon oder Rechteck) für den relativen Punkt.
 * Erweiterung:
 *  – Polygon-Hit-Test sammelt jetzt ALLE vorhandenen (xN/yN)-Paare und ignoriert Lücken.
 *  – Fallback: Wenn weniger als 3 Punkte vorhanden sind (z. B. genau 2), wird eine
 *    achsenparallele Bounding-Box aus den vorhandenen Punkten gebildet und darauf getestet.
 */
function findAreaAtPoint(relX, relY, areasArr) {
    const px = relX * canvasWidth;
    const py = relY * canvasHeight;
    const FUZZ = 1; // 1px Toleranz gegen Rundungsfehler

    return areasArr.find(a => {
        const coords = a.coords || {};

        // ---- Polygon-Zweig, sobald irgendein dritter Index existiert (legacy: x3/y3 kann vorhanden sein) ----
        if (coords.x3 !== undefined || coords.y3 !== undefined) {
            // 1) Alle tatsächlich vorhandenen Punkte einsammeln (Lücken überspringen)
            const pts = [];
            for (let i = 1; i <= 16; i++) { // großzügiges Limit
                const xi = coords[`x${i}`];
                const yi = coords[`y${i}`];
                if (xi != null && yi != null) {
                    pts.push({x: xi * canvasWidth, y: yi * canvasHeight});
                }
            }

            // 2) Regulärer Polygon-Test ab 3 Punkten
            if (pts.length >= 3) {
                return isPointInPolygon(pts, {x: px, y: py});
            }

            // 3) Fallback: bei genau 2+ Punkten auf Bounding-Box testen
            if (pts.length >= 2) {
                const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                const x1 = Math.min(...xs) - FUZZ, x2 = Math.max(...xs) + FUZZ;
                const y1 = Math.min(...ys) - FUZZ, y2 = Math.max(...ys) + FUZZ;
                return px >= x1 && px <= x2 && py >= y1 && py <= y2;
            }

            // zu wenig Punkte - kein Treffer
            return false;
        }

        // ---- Rechteck-Zweig (x1/y1/x2/y2) ----
        if (coords.x1 == null || coords.y1 == null || coords.x2 == null || coords.y2 == null) {
            return false;
        }

        const x1 = coords.x1 * canvasWidth - FUZZ;
        const y1 = coords.y1 * canvasHeight - FUZZ;
        const x2 = coords.x2 * canvasWidth + FUZZ;
        const y2 = coords.y2 * canvasHeight + FUZZ;

        return px >= x1 && px <= x2 && py >= y1 && py <= y2;
    });
}

/* ======================================================================
 * Mini-Gate Mapping (7m): Klicks auf die kleinen Mini-Tore (rechts oben)
 * werden auf die bestehenden 3 × 3 Goal-Areas (OL - UR) gemappt.
 * ─ Minimal-invasiv: kein Duplizieren von Areas, nur Rechenlogik.
 * ====================================================================*/

/* ★★ WICHTIG: Diese Werte einmalig auf eure Canvas-Grafik anpassen ★★
   Sie definieren das Bounding-Rect der kleinen Mini-Tore relativ (0..1).
   Als Startwert grob aus dem Screenshot geschätzt – bitte feinjustieren. */
const MINI_GOAL_BBOX = {
    x1: 0.715,
    y1: 0.020,
    x2: 0.965,
    y2: 0.195
};

/* ======================================================================
 * Quick-Button „7m“ (Overlay) – schnelles Loggen GEHALTEN/TOR
 * über eine kompakte Schaltfläche direkt am Mini-Tor.
 * ====================================================================*/

const SEVENM_BTN_ID = 'sevenm-quick-btn';

/** Erzeugt die 7m-Quick-Schaltfläche einmalig (Markup wie Rival-Buttons). */
function ensureSevenMQuickBtn() {
    // Feature toggle: keep code path, but do not render while disabled.
    if (!ENABLE_SEVENM_QUICK) return;
    // Basis: Button im selben Container wie das Canvas platzieren
    const host = canvas?.parentElement;
    if (!host) return;

    if (document.getElementById(SEVENM_BTN_ID)) return; // bereits vorhanden

    const btn = document.createElement('button');
    btn.id = SEVENM_BTN_ID;
    btn.type = 'button';
    btn.className = 'gk-overview-action-btn sevenm-overlay-btn';
    btn.dataset.pos = '7m';
    btn.dataset.upgraded = '1';
    btn.setAttribute('aria-label', '7m schnell erfassen');

    btn.innerHTML = `
    <span class="rival-mini rival-mini--neg" data-quick="save" aria-label="Gehalten">P</span>
    <span class="rival-label">7m</span>
    <span class="rival-mini rival-mini--pos" data-quick="goal" aria-label="Tor">T</span>
  `;

    /* --- NUR die Textfarbe der Mini-Labels auf diesem Button anpassen ----
       wir überschreiben gezielt die Schriftfarbe:
                P (Gehalten) = Grün, T (Tor) = Rot. Der Hintergrund bleibt unverändert. */
    const miniSave = btn.querySelector('.rival-mini[data-quick="save"]');
    const miniGoal = btn.querySelector('.rival-mini[data-quick="goal"]');
    if (miniSave) miniSave.style.color = '#00b050'; // Grün wie Marker für Saves
    if (miniGoal) miniGoal.style.color = '#ff0000'; // Rot wie Marker für Tore

    // Nur Klicks auf die Mini-Icons (−/+) verarbeiten – Rest ignorieren
    btn.addEventListener('click', (e) => {
        const quickEl = e.target.closest('.rival-mini[data-quick]');
        if (!quickEl) return;
        e.stopPropagation();
        e.preventDefault();
        const isSave = quickEl.dataset.quick === 'save';
        void quickSevenM(isSave);
    });

    // Wichtig: absolute Positionierung über dem Canvas
    btn.style.position = 'absolute';
    btn.style.zIndex = '2147483647';

    host.appendChild(btn);
    placeSevenMQuickBtn();
}

/** Repositioniert die 7m-Quick-Schaltfläche relativ zur MINI_GOAL_BBOX. */
function placeSevenMQuickBtn() {
    const btn = document.getElementById(SEVENM_BTN_ID);

    // While disabled, make sure the button stays hidden (even if it exists).
    if (!ENABLE_SEVENM_QUICK) {
        if (btn) btn.setAttribute('hidden', 'true');
        return;
    }

    if (!btn || !canvas) return;

    // Anchor: rechte obere Ecke der Mini-Gate-Box
    const cw = canvasWidth;
    const ch = canvasHeight;

    // Pixelkoordinaten im Canvas-Koordinatensystem
    const anchorX = MINI_GOAL_BBOX.x2 * cw;
    const anchorY = MINI_GOAL_BBOX.y1 * ch;

    // Host-Offset (Button ist absolut zum Canvas-Elterncontainer)
    const host = canvas.parentElement;
    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    // Position des Canvas innerhalb des Hosts
    const offsetLeft = canvasRect.left - hostRect.left;
    const offsetTop = canvasRect.top - hostRect.top;

    // Kleiner Innenabstand, damit der Button die Mini-Gates nicht verdeckt
    const M = 6;

    // Größe erst nach Einfügen messbar
    const bw = btn.offsetWidth || 88;

    // Oben rechts an die Box „andocken“
    const leftPx = Math.round(offsetLeft + anchorX - bw - M);
    const topPx = Math.round(offsetTop + anchorY + M);

    btn.style.left = `${leftPx}px`;
    btn.style.top = `${topPx}px`;

    // Aktivier-/Deaktivier-Logik an den laufenden Workflow koppeln:
    // Während einer begonnenen Aufnahme (Step 2) sperren, um Verwechslungen zu vermeiden
    btn.disabled = !!currentShotPosition;
}

/** Schnelles Erzeugen eines 7m-Shots (ohne Koordinaten/Goal-Sektor). */
async function quickSevenM(isSave) {
    // Halbzeit stabil über die zentrale Logik bestimmen
    const halfAtShot = computeHalfAtNow();

    // Standard-Zeitstempel + Meta (analog finishShot)
    const shot = {
        timestamp: new Date().toISOString(),
        gameTime: formatTime(gameSeconds),
        gameMinutesFloor: Math.floor(gameSeconds / 60),
        gameSeconds,
        // Minimal-Logik für 7m: Kategorie setzen, aber keine exakten Koordinaten
        shotCategory: '7m',
        isGoalkeeperSave: isSave,
        goalkeeperId: currentGoalkeeper,
        half: halfAtShot
        // Hinweis: goalAreaId bewusst weggelassen - Tabelle/Export behandeln '7m' bereits sauber
    };

    try {
        shot.id = await addShot(shot);
    } catch (e) {
        console.warn('[7m] IDB write failed', e);
    }

    shots.push(shot);

    // ----- Live-Score nachziehen, wenn gegen uns und Tor -----
    if (!isSave) {
        await updateLiveScore(true);
    }

    // UI konsistent aktualisieren
    updateStatistics();
    renderShotTable();
    renderGkOverviewTable();
    renderGKStatTable();
    drawAreas();
    updateButtonStates();

    const toastEl = showToast(isSave ? '7m – Gehalten' : '7m – Tor', 'update');
    if (toastEl && !isSave) {
        // Rotton mit gutem Kontrast; Border gleich mitziehen
        toastEl.style.backgroundColor = '#c62828'; // Rot für „Tor“
        toastEl.style.borderColor = '#c62828';
        toastEl.style.color = '#fff';
    }
}

// 7m
async function commitSevenMImmediate(isSave) {
    const halfAtShot = computeHalfAtNow();
    const isAgainstUs = (sevenMState.team || 'rival') === 'rival';
    const gkId = isAgainstUs ? currentGoalkeeper : (currentRivalGoalkeeper ?? 1);

    const shot = {
        timestamp: new Date().toISOString(),
        gameTime: formatTime(gameSeconds),
        gameMinutesFloor: Math.floor(gameSeconds / 60),
        gameSeconds,
        shotCategory: '7m',
        shotAreaId: undefined,
        goalAreaId: undefined,
        exactShotPos: null,
        exactGoalPos: null,
        isGoalkeeperSave: isSave,
        goalkeeperId: gkId,
        half: halfAtShot,
        ...(isAgainstUs ? {} : {team: 'rival'})
    };

    try {
        shot.id = await addShot(shot);
    } catch {
    }

    shots.push(shot);

    // ----- nur wenn gegen uns und Tor → HT/FT refresh -----
    if (isAgainstUs && !isSave) {
        await updateLiveScore(true);
    }

    updateStatistics();
    renderShotTable();
    renderGkOverviewTable();
    renderGKStatTable();
    drawAreas();
    updateButtonStates();

    showToast(isSave ? '7m – Gehalten' : '7m – Tor', 'update');
}

/** Liefert – falls möglich – die getroffene Goal-Area.
 *  1) Standard-Rechteck/Polygon-Treffer in `goalAreas`
 *  2) Falls kein Treffer: Mini-Tor-Bereich in 3 × 3 Zellen teilen und Namen (OL - UR) bestimmen
 */
function getClickedGoalArea(relX, relY) {
    const area = findAreaAtPoint(relX, relY, goalAreas);
    if (area) return area;

    const {x1, y1, x2, y2} = MINI_GOAL_BBOX;
    if (relX < x1 || relX > x2 || relY < y1 || relY > y2) return null;

    const rx = (relX - x1) / (x2 - x1);
    const ry = (relY - y1) / (y2 - y1);

    const col = rx < 1 / 3 ? 0 : (rx < 2 / 3 ? 1 : 2); // L/M/R
    const row = ry < 1 / 3 ? 0 : (ry < 2 / 3 ? 1 : 2); // O/M/U

    const ROW = ['O', 'M', 'U'];
    const COL = ['L', 'M', 'R'];
    const key = `${ROW[row]}${COL[col]}`; // 'OM', 'MM', 'UR' …

    return goalAreas.find(g => canonicalSectorName(g.name) === key) || null;
}

// == 13. Helfer-Funktionen ===============================================
/* ---------- Tor-Sektoren: Kanonisieren + Spiegeln (GK-Perspektive) ---------- */

/* ——— TOP/MID/BOTTOM sauber auf O/M/U mappen ——— */
function canonicalSectorName(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const MAP = {
        // EN - Kanon (Oben/Mitte/Unten)
        'TOP LEFT': 'OL', 'UP LEFT': 'OL', 'UPPER LEFT': 'OL', 'TL': 'OL',
        'TOP MIDDLE': 'OM', 'TOP CENTER': 'OM', 'TM': 'OM',
        'TOP RIGHT': 'OR', 'UP RIGHT': 'OR', 'UPPER RIGHT': 'OR', 'TR': 'OR',

        'MID LEFT': 'ML', 'MIDDLE LEFT': 'ML', 'CENTER LEFT': 'ML',
        'MID MIDDLE': 'MM', 'MIDDLE MIDDLE': 'MM', 'MIDDLE': 'MM', 'CENTER': 'MM',
        'MID CENTER': 'MM', 'MIDDLE CENTER': 'MM', 'CENTER MIDDLE': 'MM',
        'MID RIGHT': 'MR', 'MIDDLE RIGHT': 'MR', 'CENTER RIGHT': 'MR',

        'BOTTOM LEFT': 'UL', 'LOW LEFT': 'UL', 'DOWN LEFT': 'UL', 'BL': 'UL',
        'BOTTOM MIDDLE': 'UM', 'LOW MIDDLE': 'UM', 'DOWN MIDDLE': 'UM', 'BOTTOM CENTER': 'UM', 'BM': 'UM',
        'BOTTOM RIGHT': 'UR', 'LOW RIGHT': 'UR', 'DOWN RIGHT': 'UR', 'BR': 'UR',

        // Bereits kanonisch (DE)
        'OL': 'OL', 'OM': 'OM', 'OR': 'OR', 'ML': 'ML', 'MM': 'MM', 'MR': 'MR', 'UL': 'UL', 'UM': 'UM', 'UR': 'UR',
        // Kürzel "M" aus Default-Goal-Areas auf "MM" normalisieren (einheitliche 2-Buchstaben-Form)
        'M': 'MM',
        // Sonderfälle
        '7M': '7M', '7 M': '7M', '–': '–', '-': '–',
    };
    return MAP[s] || s;
}

/* ======= 7m-Quickflow: Zustandsmaschine ================================== */
/**
 * State-Maschine für den 7m-Workflow:
 *  - active:         7m-Modus ist eingeschaltet
 *  - pendingOutcome: 'tor' | 'save' | null  → welches Ergebnis wurde gewählt?
 *  - team:           'own' | 'rival'        → optional: welches Team schießt?
 *  - gkId:           1|2                    → aktiver Torwart (für Zuordnung)
 */
const sevenMState = {
    active: false,
    pendingOutcome: null,
    team: 'rival', // falls bei dir der 7m im Standard gegen unseren Keeper läuft
    gkId: 1
};

/** Fester 7m-Abwurfort (wird NICHT geklickt, rein dokumentarisch) */
const SEVEN_M_THROW_POINT = {x: null, y: null};
// Absichtlich null: keine Markierung erforderlich, Anforderung des Kunden.

/* ======= 7m-Quickflow: Steuerfunktionen =================================== */
/** Aktiviert den 7m-Modus und setzt das visuelle UI-Feedback. */
function startSevenMFlow(teamHint = 'rival') {
    sevenMState.active = true;
    sevenMState.pendingOutcome = null;
    sevenMState.team = teamHint;
    sevenMState.gkId = (sevenMState.team === 'rival')
        ? currentGoalkeeper               // Rival schießt → unser Keeper relevant
        : (currentRivalGoalkeeper ?? 1);  // Wir schießen → gegnerischer Keeper

    // (Optional) Buttons optisch hervorheben
    document.body.classList.add('sevenm-active');
    // Falls du ein Badge / Hinweis-Overlay hast: hier ein-/aktualisieren.
}

/* ======= 7m-Quickflow: Abgriff des Canvas-Klicks ====================*/
function handleCanvasClickForSevenM(e) {

    // 7m-spezifischer Click-Handler mit Vorrang.
    // Ziel: Während des 7m-Workflows KEINE Interaktionen auf dem großen Feld zulassen,
    // damit keine "3-Klick"-Alternative entsteht. Erlaubt sind nur Klicks in den Mini-Toren (3×3).

    // 1) Aktiv nur, wenn wir uns tatsächlich im 7m-Schritt befinden
    const isSevenMActive =
        !!currentShotPosition && normalize(currentShotPosition.name ?? '') === '7m';
    if (!isSevenMActive) return false; // Standard-Flow weiterlaufen lassen

    // 2) Relative Koordinaten des Klicks holen
    const {relX, relY} = getRelCoords(e);
    const {x1, y1, x2, y2} = MINI_GOAL_BBOX;

    // 3) Liegt der Klick INNERHALB der Mini-Tor-Box?
    const insideMini =
        relX >= x1 && relX <= x2 &&
        relY >= y1 && relY <= y2;

    if (!insideMini) {
        // Während 7m keine Klicks auf dem großen Feld zulassen
        // (keine Temp-Marker, keine Toasts) - komplett schlucken.
        return true; // Event vollständig behandelt (ignoriert)
    }

    // 4) Falls innerhalb Mini-Tor: Ziel-Sektor (optional) übernehmen
    // bleibt wie bisher ein rein temporärer Schritt vor Tor/Gehalten.
    const goalArea = getClickedGoalArea(relX, relY);
    if (!goalArea) {
        // Sollte nicht passieren – zur Sicherheit Klick ignorieren.
        return true;
    }

    // Grauen Temp-Marker am Mini-Tor platzieren (nur visuelles Feedback)
    paintTempMarker(relX, relY);
    currentExactGoalPos = {x: relX, y: relY};
    currentGoalArea = goalArea;
    updateButtonStates(); // Tor/Gehalten aktivieren (7m erlaubt das auch ohne Sektor)
    drawAreas();

    return true; // 7m hat den Klick verarbeitet – Haupt-Handler nicht mehr ausführen
}

/* ======= 7m-Quickflow: Button-Eventbindung =================================
   Erwartete Buttons (IDs bitte ggf. an dein Markup anpassen):
     - #btn-sevenm         → aktiviert 7m-Modus
     - #btn-sevenm-tor     → Ergebnis „Tor“
     - #btn-sevenm-save    → Ergebnis „Gehalten“
=============================================================================*/
function bindSevenMButtons() {
    const btn7m = document.getElementById('btn-sevenm');
    const btnTor = document.getElementById('btn-sevenm-tor');
    const btnSave = document.getElementById('btn-sevenm-save');

    if (btn7m) {
        btn7m.addEventListener('click', () => {
            // Optional: falls Toggle gewünscht → bei aktiv erneut: Abbruch
            if (sevenMState.active) {
                cancelSevenMFlow();
                return;
            }
            // Standard: 7m starten. Team-Hinweis ggf. dynamisch ermitteln (eigene/rival)
            startSevenMFlow('rival');
        });
    }
    if (btnTor) btnTor.addEventListener('click', () => setSevenMOutcome('tor'));
    if (btnSave) btnSave.addEventListener('click', () => setSevenMOutcome('save'));
}

/** Setzt das anstehende Ergebnis (Tor/Gehalten) im 7m-Modus. */
function setSevenMOutcome(outcome /* 'tor' | 'save' */) {
    if (!sevenMState.active) startSevenMFlow('rival');
    sevenMState.pendingOutcome = outcome;

    const isSave = outcome === 'save';
    commitSevenMImmediate(isSave).finally(() => {
        cancelSevenMFlow();
    });

    document.body.classList.toggle('sevenm-outcome-tor', outcome === 'tor');
    document.body.classList.toggle('sevenm-outcome-save', outcome === 'save');
}

/** Bricht den 7m-Modus vollständig ab. */
function cancelSevenMFlow() {
    sevenMState.active = false;
    sevenMState.pendingOutcome = null;
    document.body.classList.remove('sevenm-active', 'sevenm-outcome-tor', 'sevenm-outcome-save');
}

function mirrorGoalSector(abbrevRaw) {
    const k = canonicalSectorName(abbrevRaw);
    const MIRROR = {
        'OL': 'OR', 'OR': 'OL',
        'ML': 'MR', 'MR': 'ML',
        'UL': 'UR', 'UR': 'UL',
        'OM': 'OM', 'MM': 'MM', 'UM': 'UM',
        '7M': '7M', '–': '–'
    };
    return MIRROR[k] || k;
}

// Rival-Toggle voll synchron zur eigenen GK-Logik,
// aber ohne Trikot-„#“, nur „Torwart 1/2“. Farbschema kommt über Klassenwechsel.
function updateRivalGoalkeeperButton() {
    const btn = document.querySelector('.gk-overview-toggle-btn');
    if (!btn) return;

    // Optik-Klasse einmalig sicherstellen
    btn.classList.add('rivalkeeper-button');

    // neutrales Label – ohne „#“, wie gewünscht
    btn.textContent = `Torwart ${currentRivalGoalkeeper}`;

    // Farbschema präzise umschalten (1 ↔ 2)
    btn.classList.toggle('rivalkeeper-1', currentRivalGoalkeeper === 1);
    btn.classList.toggle('rivalkeeper-2', currentRivalGoalkeeper === 2);
}

/**
 * Schreibt für eine Tabellenzeile (tr) die Felder „Paraden/gesamt“ (TOTAL_IDX)
 * und „%“ (PERCENT_IDX) anhand der bereits eingetragenen Werte in
 * Spalte 2 (Saves) und GOALS_TOTAL_IDX (Gegentore „T“).
 */
function writeTotalsForRow(tr) {
    // --- Deutschsprachige Kommentare (gewünscht) ---------------------
    const td = tr.children;

    const saves = +(td[2]?.textContent ?? 0) || 0;
    const goals = +(td[GOALS_TOTAL_IDX]?.textContent ?? 0) || 0;
    const total = saves + goals;

    if (total > 0) {
        td[TOTAL_IDX].textContent = `${saves}/${total}`;
        td[PERCENT_IDX].textContent = Math.round((saves / total) * 100) + '%';
    } else {
        // Visuell „ruhig“ halten: leere Felder, wenn keine Events vorliegen
        td[TOTAL_IDX].textContent = '';
        td[PERCENT_IDX].textContent = '';
    }
}

/* ------------------------------------------------------------------
 * Schreibt einen einzelnen Shot in eine bestehende Tabellenzeile.
 * Erwartet: die passende Zeile (richtiger GK + Halbzeit) ist bereits
 * über ROW_MAP ermittelt; diese Funktion inkrementiert die Zellen.
 *  - Nutzt Shot-Synonyme (normalize + Fallback über shotAreaMap).
 *  - Zählt Paraden gesamt (Spalte 2), Gegentore gesamt (GOALS_TOTAL_IDX)
 *    und die wurfartspezifischen Spalten (LEFT_COL_MAP/RIGHT_COL_MAP).
 * ------------------------------------------------------------------ */
function applyShotToRow(tr, sh) {
    const td = tr.children;

    // 1) Wurfkategorie robust bestimmen (Shot-Feld - Fallback auf Area-Name)
    const areaName = shotAreaMap.get(sh.shotAreaId)?.name ?? '';
    const baseName = normalize(sh.shotCategory ?? areaName);

    // 2) Auf Spalten-Key mappen; Unbekanntes ignorieren
    const colKey = AREA_TO_COL[baseName];
    if (!colKey) return;

    // 3) Links (Parade) vs. rechts (Gegentor) hochzählen
    if (sh.isGoalkeeperSave) {
        // Paraden gesamt
        td[2].textContent = ((+td[2].textContent) || 0) + 1;
        // Paraden je Wurfart
        td[LEFT_COL_MAP[colKey]].textContent =
            ((+td[LEFT_COL_MAP[colKey]].textContent) || 0) + 1;
    } else {
        // Gegentore je Wurfart
        td[RIGHT_COL_MAP[colKey]].textContent =
            ((+td[RIGHT_COL_MAP[colKey]].textContent) || 0) + 1;
        // T gesamt
        td[GOALS_TOTAL_IDX].textContent =
            ((+td[GOALS_TOTAL_IDX].textContent) || 0) + 1;
    }
}

/**
 * Ermittelt die aktuell gültige Halbzeit (1/2) auf Basis der zentralen
 * Logik in `currentHalf()`. Dieser Helper dient dazu, die Halbzeit
 * **beim Erfassen** eines Ereignisses stabil zu übernehmen, ohne die
 * Bedingung an mehreren Stellen zu duplizieren (DRY).
 * @returns {1|2}
 */
function computeHalfAtNow() {
    // Delegation an `currentHalf()` hält die Logik zentral.
    return currentHalf();
}

// Liefert den Index des letzten eigenen Shots *für den aktuellen Keeper* oder -1.
// (RIVAL-Shots werden ignoriert.)
function lastOwnShotIndexForCurrentGK() {
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        if (s.team !== 'rival' && (s.goalkeeperId ?? 1) === currentGoalkeeper) {
            return i;
        }
    }
    return -1;
}

// ——— Helper: Ass-Zähler komplett zurücksetzen ——————————————
/** Setzt alle Zähler (beide Keeper × beide Halbzeiten) auf 0 und aktualisiert Badge/Tabellen. */
async function resetAssCounters(skipRender = false) {
    // 1) In-Memory auf Werkseinstellung
    ass = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

    // 2) Persistieren
    await setAss(ass);

    // 3) UI-Update (Badge sofort)
    updateAssBadge();

    // 4) Große GK-Tabelle nur rendern, wenn kein Batch-Reset läuft
    if (!skipRender) renderGKStatTable();

    // 5) Minus-Button deaktivieren (0 kann nicht weiter dekrementiert werden)
    const dec = document.getElementById('ass-decrement');
    if (dec) dec.disabled = true;
}

/** Setzt alle Zähler (beide Keeper × beide Halbzeiten) auf 0 und aktualisiert Badge/Tabellen. */
async function resetSevenG6Counters(skipRender = false) {
    // Datenstruktur komplett zurücksetzen (#1/#2 × HZ1/HZ2)
    sevenG6 = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

    await setSevenG6(sevenG6);

    // Badge sofort aktualisieren (Halbzeit-/GK-abhängig)
    updateSevenG6Badge();

    // Tabelle nur aufbauen, wenn nicht gebatcht
    if (!skipRender) renderGKStatTable();

    const dec = document.getElementById('seven-g6-decrement');
    if (dec) dec.disabled = true;
}

/** Setzt alle Zähler (beide Keeper × beide Halbzeiten) auf 0 und aktualisiert Badge/Tabellen. */
async function resetTorCounters(skipRender = false) {
    // Eigene-Tore-Zähler für beide Keeper auf 0 setzen
    torCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

    await setTor(torCount);

    // Badge sofort updaten
    updateTorBadge();

    // GK-Stat-Tabelle nur neu zeichnen, wenn kein Batch-Reset läuft
    if (!skipRender) renderGKStatTable();

    const dec = document.getElementById('tor-decrement');
    if (dec) dec.disabled = true;
}

/** Setzt alle Zähler (beide Keeper × beide Halbzeiten) auf 0 und aktualisiert Badge/Tabellen. */
async function resetTFCounters(skipRender = false) {
    // Technische-Fehler-Zähler für beide Keeper auf 0 setzen
    tfCount = {1: {1: 0, 2: 0}, 2: {1: 0, 2: 0}};

    await setTF(tfCount);

    // Badge sofort updaten
    updateTFBadge();

    // GK-Stat-Tabelle nur neu zeichnen, wenn kein Batch-Reset läuft
    if (!skipRender) renderGKStatTable();

    const dec = document.getElementById('tf-decrement');
    if (dec) dec.disabled = true;
}

/* ---------- Spalten-Layout ----------
   Feste Indizes: wichtig, um sowohl Paraden- als auch Gegentor-Spalten
   zuverlässig zu treffen. COLS = 33 - Indizes 0..32.
   Die Maps LEFT_COL_MAP/RIGHT_COL_MAP sind dabei die einzigen "Wahrheiten"
   für Zonen-Spalte. */
const ASS_IDX = 14; // Spalte Ass
const TOR_HEAD_IDX = 15; // Spalte „Tor“ (eigene Tore, nicht Gegentore!)
const DIVIDER_IDX = 16; // Visueller Trenner
const GOALS_TOTAL_IDX = 17; // Spalte „T“ (Gegentore insgesamt)
const SEVENG6_IDX = COLS - 4; // 29: 7g6 (manueller Zähler)
const TF_IDX = COLS - 3; // 30: Technische Fehler
const TOTAL_IDX = COLS - 2; // 31: Quote Zähler "Paraden/gesamt"
const PERCENT_IDX = COLS - 1; // 32: Prozentzahl „%“

// ===================================================================
// Debug-Ausgaben für die GK-Haupttabelle (nur in Entwicklung nutzen)
// ===================================================================

// Entwicklungs-Flag für Debug-Ausgaben der Aggregationswerte
const DEBUG_STATS = false;

function debugRow(tag, td) {
    if (!DEBUG_STATS) return;
    // Ausgabe: Label, Saves, T, 7g6, TF, Total, %
    console.debug(tag, {
        saves: td[2]?.textContent,
        T: td[GOALS_TOTAL_IDX]?.textContent,
        seven: td[SEVENG6_IDX]?.textContent,
        tf: td[TF_IDX]?.textContent,
        total: td[TOTAL_IDX]?.textContent,
        pct: td[PERCENT_IDX]?.textContent
    });
}

/* ----------------------------------------------------------------------
 Summenzeile (Coach-Wunsch): nur bestimmte Wurfarten einbeziehen
 – Rückraum: rl, rm, rr
 – Außen: la, ra
 – Durchbruch: dl, dm, dr
 Legacy-Fall: ältere Datensätze haben „db“/„durchbruch“ - zählen als Durchbruch.
 Wir werten deshalb direkt über `shots` aus (nicht über Tabellenspalten),
 um diese Synonyme sicher zu erwischen.
---------------------------------------------------------------------- */
const SUM_INCLUDED_KEYS = new Set([
    'rl', 'rm', 'rr',
    'la', 'ra',
    'dl', 'dm', 'dr',
    'db', 'durchbruch' // Legacy-Synonyme
]);

/* ---------- Stabiler Schlüssel für (auch) offline-Shots -------------------
   Falls ein Shot noch keine 'id' besitzt (Offline-Erfassung), vergeben wir
   einmalig 'localId' (UUID oder Fallback). Dieser Schlüssel wird in der UI
   (Tabellenzeile + Radial-Menü) verwendet, bis ein Server-/DB-'id' vorhanden ist.
---------------------------------------------------------------------------- */
function ensureLocalKey(shot) {
    // Wenn bereits eine persistente id existiert: diese als Schlüssel nutzen
    if (shot.id != null) return String(shot.id);

    // Einmalige lokale Kennung erzeugen und am Objekt speichern
    if (!shot.localId) {
        shot.localId =
            (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID() // moderner, kollisionsarm
                : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; // Fallback
    }
    return shot.localId;
}

// Normalisierung: Umlaute/ß entfernen, lowercasing
// so matchen wir zuverlässig auch legacy-Bezeichnungen auf AREA_TO_COL.
// Normalisierung: Diakritika entfernen, ß-ss, alle Whitespaces entfernen, in Kleinbuchstaben
const normalize = (s = '') => String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, '')
    .toLowerCase();

/**
 * Baut die große Aggregations-Tabelle für unsere Keeper (4 Zeilen: #1/#2 × HZ 1/2).
 */
function renderGKStatTable() {
    const tbody = document.querySelector('#gk-stat-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // 1) Vier feste Zeilen (GK1/2 × HZ1/2) anlegen
    const ROW_META = [
        {gk: 1, half: 1, time: '01-30'},
        {gk: 1, half: 2, time: '31-60'},
        {gk: 2, half: 1, time: '01-30'},
        {gk: 2, half: 2, time: '31-60'}
    ];
    const ROW_MAP = {};
    ROW_META.forEach(meta => {
        const key = `${meta.gk}-${meta.half}`;
        const gkNum = GOALKEEPERS[meta.gk]?.number ?? meta.gk;
        const tr = makeEmptyStatRow(`#${gkNum} ${meta.half}. HZ`, meta.time);
        tr.dataset.key = key;
        ROW_MAP[key] = tr;
        tbody.appendChild(tr);
    });

    // 2) eigene Shots
    shots.forEach(sh => {
        if (sh.team === 'rival') return;
        const gk = sh.goalkeeperId ?? 1;
        const half = sh.half ?? (sh.gameSeconds < HALF_LENGTH ? 1 : 2);
        const tr = ROW_MAP[`${gk}-${half}`];
        if (!tr) return;
        applyShotToRow(tr, sh);
    });

    // 3) Manuelle Zähler (Ass, 7g6, Eigene Tore, TF)
    for (const gk of [1, 2]) {
        for (const half of [1, 2]) {
            const key = `${gk}-${half}`;
            const tr = ROW_MAP[key];
            if (!tr) continue;

            const td = tr.children;

            // -------------------------------------------------------------
            // Sichtbarkeitsregel: 7g6/TF in der 2. HZ NICHT anzeigen.
            // Wichtig: Wir verstecken NUR die Anzeige; die Werte dürfen
            // weiterhin in "T" (Gesamttore) einfließen, damit die Quote stimmt.
            // -------------------------------------------------------------
            const HIDE_MANUALS_IN_SECOND_HALF = true;  // Feature-Flag für die GUI
            const hideManuals = HIDE_MANUALS_IN_SECOND_HALF && half === 2;

            // Ass (wird auch in 2. HZ angezeigt — keine Einschränkungen)
            const assVal = ass[gk]?.[half] ?? 0;
            td[ASS_IDX].textContent = assVal === 0 ? '' : String(assVal);

            // 7g6 — Anzeige in HZ2 unterdrücken (aber in "T" weiterhin berücksichtigen)
            const sevenVal = sevenG6[gk]?.[half] ?? 0;
            td[SEVENG6_IDX].textContent = hideManuals
                ? ''
                : (sevenVal === 0 ? '' : String(sevenVal));

            // Eigene Tore (Tor) — in beiden HZ anzeigen (keine Einschränkungen)
            const torVal = torCount[gk]?.[half] ?? 0;
            td[TOR_HEAD_IDX].textContent = torVal === 0 ? '' : String(torVal);

            // TF — Anzeige in HZ2 unterdrücken
            const tfVal = tfCount[gk]?.[half] ?? 0;
            td[TF_IDX].textContent = hideManuals
                ? ''
                : (tfVal === 0 ? '' : String(tfVal));

            // 7g6 wird NICHT in die Torwartstatistik aufgenommen
            // Früher wurde 7g6 zu "T" (kassierte Tore) hinzugefügt und hat den Prozentsatz verschlechtert.
            // Jetzt spiegelt "T" nur noch die Tore aus tatsächlich auf das Tor geworfenen
            // Episoden (Shots) wider, und 7g6 wird separat in einer eigenen Spalte angezeigt.
            // NICHTS wird zu GOALS_TOTAL_IDX hinzugefügt.
        }
    }

    // 4) Erst jetzt (nach Einrechnung 7g6 - T) die Total-/Prozent-Spalten setzen
    Object.values(ROW_MAP).forEach(tr => {
        writeTotalsForRow(tr);
        // Debug-Ausgabe pro Zeile nach Berechnung von Total/%:
        // Label bilden aus den ersten zwei Zellen ("#<Nummer> HZ" + Zeitfenster)
        debugRow(`${tr.children[0]?.textContent} ${tr.children[1]?.textContent}`, tr.children);
    });

    // 5) Σ-Zeilen je GK
    const appendGKSumRow = (gk) => {
        const gkNum = GOALKEEPERS[gk]?.number ?? gk;

        // Lesbares Label einmalig definieren und überall konsistent verwenden
        const label = `#${gkNum} Σ`;

        const tr = makeEmptyStatRow(label, 'Σ');
        const td = tr.children;

        // Σ für definierte Wurfarten
        let saves = 0, goals = 0;
        for (const sh of shots) {
            if (sh.team === 'rival') continue;
            if ((sh.goalkeeperId ?? 1) !== gk) continue;

            const areaName = shotAreaMap.get(sh.shotAreaId)?.name;
            const base = normalize(sh.shotCategory ?? areaName ?? '');
            if (!SUM_INCLUDED_KEYS.has(base)) continue;

            if (sh.isGoalkeeperSave) saves++; else goals++;
        }

        const sevenSum = (sevenG6[gk]?.[1] ?? 0) + (sevenG6[gk]?.[2] ?? 0); // separat anzeigen

        td[2].textContent = saves ? String(saves) : '';
        td[SEVENG6_IDX].textContent = sevenSum ? String(sevenSum) : '';

        // Σ-Zeile: 7g6 wird NICHT zu "T" hinzugefügt — das ist nicht die Schuld des Torwarts.
        td[GOALS_TOTAL_IDX].textContent = goals ? String(goals) : '';

        writeTotalsForRow(tr);

        // Debug-Ausgabe für die Σ-Zeile (nur wenn DEBUG_STATS=true)
        // debugRow(`${label} ${td[1]?.textContent}`, tr.children);
        debugRow(`#${gkNum} Σ ${td[1]?.textContent}`, tr.children);

        tr.classList.add('gk-sum-row');
        tbody.appendChild(tr);
    };

    appendGKSumRow(1);
    appendGKSumRow(2);
}

/**
 * Aggregations-Tabelle für den Rivalen (gleiches Layout wie unsere Keeper),
 * aber ohne manuelle Zähler. Bezeichner-Stil bewusst anders („Torwart 1/2 …“)
 * zur klaren optischen Trennung.
 */
function renderRivalGKStatTable() {
    const tbody = document.querySelector('#rival-gk-stat-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Meta-Layout: 4 feste Zeilen (#1/#2 × HZ 1/2)
    const ROW_META = [
        {gk: 1, half: 1, time: '01-30'},
        {gk: 1, half: 2, time: '31-60'},
        {gk: 2, half: 1, time: '01-30'},
        {gk: 2, half: 2, time: '31-60'}
    ];

    const ROW_MAP = {};
    ROW_META.forEach(meta => {
        const key = `${meta.gk}-${meta.half}`;

        // "Torwart 1 1. HZ" – statt "#1 1. HZ". So ist die UI klar getrennt zu unseren Keepern.
        const tr = makeEmptyStatRow(`Torwart ${meta.gk} ${meta.half}. HZ`, meta.time);
        tr.dataset.key = key;

        ROW_MAP[key] = tr;
        tbody.appendChild(tr);
    });

    // ---- 2) Rival-Shots einsortieren ----------------------------------
    shots.forEach(sh => {
        if (sh.team !== 'rival') return;
        const gk = sh.goalkeeperId ?? 1;
        const half = sh.half ?? (sh.gameSeconds < HALF_LENGTH ? 1 : 2);
        const tr = ROW_MAP[`${gk}-${half}`];
        if (!tr) return;
        applyShotToRow(tr, sh);
    });

    // ---- 3) Gesamt/Quote + manuelle Spalten leeren ---------------------
    Object.values(ROW_MAP).forEach(tr => {
        writeTotalsForRow(tr);

        const td = tr.children;
        // Rival führt keine manuellen Zähler - leer lassen
        td[ASS_IDX].textContent = '';
        td[TOR_HEAD_IDX].textContent = '';
        td[SEVENG6_IDX].textContent = '';
        td[TF_IDX].textContent = '';
    });
}

/** Setzt die Sektionsüberschrift konsistent auf „Shot Statistics – #<Trikotnummer>“. */
function updateStatsHeading() {
    const h2 = document.getElementById('stats-heading');
    if (!h2) return;
    h2.textContent = `Shot Statistics – ${gkNumLabel(currentGoalkeeper)}`;
}

/* ============================================================
 * HT/FT-Anzeige (universelle Ausgabe)
 * Schreibt Halbzeit- und Endstand in optionale Badges:
 * #ht-display und #ft-display
 * Falls die Elemente nicht existieren, macht die Funktion nichts.
 * Quelle ist bevorzugt das jeweilige Input-Feld, sonst MatchInfo.
 * ============================================================ */
async function updateScoreDisplays() {
    const htBox = document.getElementById('ht-display');
    const ftBox = document.getElementById('ft-display');
    if (!htBox && !ftBox) return; // Keine Anzeige vorgesehen

    // 1) Werte zunächst aus den Feldern lesen (falls vorhanden)
    let ht = (document.getElementById('halftime-input')?.value || '').trim();
    let ft = (document.getElementById('fulltime-input')?.value || '').trim();

    // 2) Falls leer, MatchInfo als Fallback heranziehen
    if ((!ht && htBox) || (!ft && ftBox)) {
        try {
            const mi = await getMatchInfo();
            if (!ht) ht = (mi?.halftime || '').trim();
            if (!ft) ft = (mi?.fulltime || '').trim();
        } catch { /* MatchInfo nicht kritisch */
        }
    }

    // 3) Anzeigen (Strich statt "0" vermeiden wir nicht; Design-Entscheidung)
    if (htBox) htBox.textContent = ht || '–';
    if (ftBox) ftBox.textContent = ft || '–';
}

/** Wandelt Client-Koordinaten in relative Canvas-Koordinaten (0…1) um. */
function getRelCoords(e) {
    const r = canvas.getBoundingClientRect();
    return {
        relX: (e.clientX - r.left) / r.width,
        relY: (e.clientY - r.top) / r.height
    };
}

/**
 * Zeigt einen Toast (update/offline) für 3 s an und gibt das DOM-Element zurück
 * (z. B. für Klick-Handler beim SW-Update).
 */
function showToast(msg, variant = 'update') {
    const container = document.getElementById('toast-container');
    if (!container) return null; // Fallback: kein Container

    const t = document.createElement('div');
    t.className = `toast toast--${variant}`;
    t.textContent = msg;

    if (container.children.length > 10) container.firstChild.remove();

    container.appendChild(t);

    /* automatische Ausblendung nach 3 s */
    setTimeout(() => {
        t.style.animation = 'toast-slide-out .3s forwards';
        t.addEventListener('animationend', () => t.remove());
    }, 3000);

    return t; // wichtig: DOM-Element zurückgeben!
}

/**
 * Entfernt alle Shots (RAM + IndexedDB) und baut alle Sichten neu auf.
 * Optional „silent“ (ohne Confirm/Toast) für Batch-Resets.
 */
async function clearAllData(silent = false) {
    /* Dialog nur zeigen, wenn nicht „silent“ */
    if (!silent && !confirm('Wirklich ALLE Würfe löschen?')) return;

    // ── Runtime-Arrays & UI ───────────────────────
    shots = [];

    updateStatistics();
    renderShotTable();
    renderRivalShotTable();
    renderRivalGKStatTable();
    renderGkOverviewTable();
    renderGKStatTable();
    drawAreas();

    /* --- Rival-Tabelle & Buttons zurücksetzen ----------- */
    enableRivalActionBtns(false);
    updateRivalUndoState();

    // ── IndexedDB Store leeren ────────────────────
    try {
        const db = await initDB();
        const tx = db.transaction('shots', 'readwrite');
        await tx.store.clear();
        await tx.done;

        if (!silent) showToast('Alle Shots gelöscht', 'update');
    } catch (e) {
        console.error('[CLEAR]', e);
        if (!silent) showToast('DB-Fehler – siehe Konsole', 'offline');
    }
}

/**
 * Werkseinstellung: Shots/Zähler/Timer/GK/Show-Lines/Match-Info zurücksetzen,
 * UI konsistent aktualisieren und Abschluss-Toast zeigen.
 */
async function hardResetGame() {
    /* 1) Alle Shots & Statistik zurücksetzen */
    await clearAllData(true);

    /* Zähler in einem Batch zurücksetzen – ohne Zwischen-Render */
    await resetAssCounters(true);
    await resetSevenG6Counters(true);
    await resetTorCounters(true);
    await resetTFCounters(true);

    /* 2) Registrierung zurücksetzen */
    resetRegistrationProcess(); // Step-Indikator & Buttons

    /* 3) Spiel-Timer stoppen & nullen */
    clearInterval(gameInterval);
    gameSeconds = 0;
    gameRunning = false;
    document.getElementById('game-time').textContent = formatTime(0);
    document.getElementById('start-pause-btn').textContent = 'Start';
    document.getElementById('reset-btn').disabled = false;
    await setGameTimerState(0, false);

    // --- 2. HZ-Flag hart zurücksetzen (werksseitig) -------------------------
    secondHalfStarted = false;
    saveSecondHalfStarted();

    /* 4) Torwart wieder auf „1“ stellen */
    currentGoalkeeper = 1;
    await setCurrentGoalkeeper(1);

    currentRivalGoalkeeper = 1;
    await setCurrentRivalGoalkeeper(1);

    updateRivalGoalkeeperButton(); // Kachel & Farbe sofort korrekt setzen
    updateGoalkeeperButton();
    refreshHalfDependentUI();
    updateStatsHeading();

    /* 5) Show-Lines-Schalter zurücksetzen */
    showShotLines = false;
    const toggle = document.getElementById('show-lines-toggle');
    if (toggle) toggle.checked = false;
    await setShowShotLines(false);

    drawAreas();

    /* 6) Match-Info zurücksetzen */
    try {
        // alle Match-Info-Keys in der IndexedDB leeren
        await Promise.all([
            setMatchInfo('competition', ''),
            setMatchInfo('date', ''),
            setMatchInfo('location', ''),
            setMatchInfo('team', ''),
            setMatchInfo('opponent', ''),
            setMatchInfo('halftime', ''),
            setMatchInfo('fulltime', ''),
            setMatchInfo('gk1Name', ''),
            setMatchInfo('gk1Number', ''),
            setMatchInfo('gk2Name', ''),
            setMatchInfo('gk2Number', '')
        ]);

        // UI-Felder zurücksetzen
        const idClear = id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        };

        // Match-Info-Felder komplett leeren
        [
            'team-input', 'opponent-input', 'halftime-input', 'fulltime-input',
            'competition-input', 'date-input', 'location-input',
            'gk1-name-input', 'gk1-number-input', 'gk2-name-input', 'gk2-number-input'
        ].forEach(idClear);

        // Lokales Modell ebenfalls „leeren“, damit sofort #<Index> greift
        GOALKEEPERS[1].name = '';
        GOALKEEPERS[1].number = undefined;
        GOALKEEPERS[2].name = '';
        GOALKEEPERS[2].number = undefined;
        refreshGoalkeeperMetaUI();

    } catch (err) {
        console.error('[RESET] Match-Info löschen fehlgeschlagen:', err);
    }

    /* 7) Feedback für den Nutzer */
    showToast('Spiel vollständig zurückgesetzt ✔', 'update');
}

/**
 * Initialisiert den GK-Toggle.
 * Optionales Verhalten:
 *  – liest den aktiven Keeper nur dann erneut aus IndexedDB,
 *    wenn `skipLoad` = false ist (Standard).
 *  – Wenn `skipLoad` = true übergeben wird (z. B. direkt nach initApp()),
 *    wird NICHT erneut geladen, sondern lediglich die UI auf den bereits
 *    bekannten `currentGoalkeeper` synchronisiert.
 *
 * @param {boolean} [skipLoad=false]  true = kein erneuter DB-Lesezugriff
 */
async function changeGoalkeeper(skipLoad = false) {
    /* --- DOM-Referenz auf den Toggle-Button ------------------------ */
    const btn = document.getElementById('change-goalkeeper-btn');
    if (!btn) {
        console.warn('[GK] Button »change-goalkeeper-btn« nicht gefunden');
        return;
    }

    /* --- Startwert nur laden, wenn explizit gewünscht -------------- */
    if (!skipLoad) {
        try {
            // Letzten Keeper aus IndexedDB laden (Default = 1)
            currentGoalkeeper = await getCurrentGoalkeeper();
        } catch (err) {
            console.warn('[GK] Laden des aktiven Keepers fehlgeschlagen:', err);
        }
    }

    /* --- UI auf den aktuell bekannten Keeper bringen ----------------
       WICHTIG: Reihenfolge beibehalten, damit abhängige Elemente
       (Badges, Tabellen, Canvas etc.) konsistent sind. */
    updateGoalkeeperButton();     // Badge/Style
    refreshHalfDependentUI();     // Halbzeitabhängige Badges + GK-Stat
    updateStatsHeading();         // H2-Überschrift
    updateStatistics();           // Boxen (Shot/Goal-Areas)
    renderShotTable();            // rechts: letzte Würfe (eigene)
    renderGkOverviewTable();      // links: Übersichtstabelle (eigene)
    drawAreas();                  // Canvas-Layer
    updateButtonStates();         // Undo-Status u. a.

    /* --- Klick-Handler einmalig binden ----------------------------- */
    if (!btn.dataset.bound) {
        btn.addEventListener('click', async () => {
            // Laufenden Erfassungsschritt sauber abbrechen, damit kein
            // halbfertiger Shot dem falschen Keeper zugeordnet wird.
            resetRegistrationProcess();

            // 1) Keeper umschalten (1 - 2)
            currentGoalkeeper = (currentGoalkeeper === 1 ? 2 : 1);

            // 2) Oberfläche konsistent neu aufbauen
            updateGoalkeeperButton();
            refreshHalfDependentUI(); // enthält renderGKStatTable
            updateStatsHeading();
            updateStatistics();
            renderShotTable();
            renderGkOverviewTable();
            drawAreas();
            updateButtonStates();

            // 3) Persistenz aktualisieren
            try {
                await setCurrentGoalkeeper(currentGoalkeeper);
            } catch (err) {
                console.error('[GK] IndexedDB-Speichern fehlgeschlagen:', err);
                showToast('Torwart-Wechsel konnte nicht gespeichert werden', 'offline');
            }
        });

        btn.dataset.bound = '1';
    }
}

/** Aktualisiert Label (#<Nummer> Name) und Farbschema des GK-Toggles. */
function updateGoalkeeperButton() {
    const btn = document.getElementById('change-goalkeeper-btn');
    if (!btn) return;

    const meta = GOALKEEPERS[currentGoalkeeper] || {};
    const num = Number.isFinite(meta.number) ? meta.number : currentGoalkeeper;
    const name = meta.name || '';

    /* Badge-Markup: <span class="gk-num">#1</span> Hernandez */
    btn.innerHTML = `<span class="gk-num">#${num}</span> ${name}`;
    btn.dataset.goalkeeperId = currentGoalkeeper;

    btn.classList.remove('goalkeeper-1', 'goalkeeper-2');
    btn.classList.add(`goalkeeper-${currentGoalkeeper}`);
}

/** Macht den letzten eigenen Wurf des aktuellen Keepers rückgängig (RAM + DB), inkl. UI-Refresh. */
async function undoLastShot() {
    // 1) Keeper-spezifisch den passenden Eintrag suchen
    const idx = lastOwnShotIndexForCurrentGK();
    if (idx < 0) {
        // Deutliches Feedback: kein Eintrag für *diesen* Keeper
        showToast('Kein Shot für diesen Torwart zum Rückgängigmachen', 'offline');
        return;
    }

    // 2) Entfernen (RAM + ggf. DB)
    const last = shots.splice(idx, 1)[0];
    if (last?.id) {
        try {
            await deleteShot(last.id);
        } catch {
            console.warn('[Undo] DB-Delete fehlgeschlagen');
        }
    }

    // 3) UI neu aufbauen (nur unsere Sichten)
    updateStatistics();
    renderShotTable();
    renderGkOverviewTable();
    renderGKStatTable();
    drawAreas();
    showToast('Letzter Shot zurückgenommen', 'update');

    // 4) Live-Score **sofort** neu berechnen,
    //    aber nur wenn wir ein Gegentor (gegen uns) zurückgenommen haben.
    //    Rival-Shots kommen hier nicht vor.
    if (last && !last.isGoalkeeperSave) {
        try {
            // ---- DE: Halbzeit des entfernten Schusses bestimmen ------------
            // Falls 'half' fehlt, über gameSeconds heuristisch schätzen.
            const lastHalf =
                last.half ??
                ((last.gameSeconds ?? FULL_LENGTH) < HALF_LENGTH ? FIRST_HALF : SECOND_HALF);

            // ---- DE: FT (Gesamt bis 60:00) ist **immer** betroffen → neu schreiben (force=true)
            await autoFillFulltimeScore(true);

            // ---- DE: HT (bis 30:00) nur dann neu schreiben, wenn der entfernte Schuss in HZ1 lag
            if (lastHalf === FIRST_HALF) {
                await autoFillHalftimeScore(true);
            }
        } catch (e) {
            console.warn('[Undo] Live-Score update failed:', e);
        }
    }

    // 5) Buttons/States aktualisieren (abhängig vom akt. Keeper)
    updateButtonStates();
}

/** Zeichnet einen temporären Marker an relativer Position (Helfer für den Workflow). */
function paintTempMarker(relX, relY, color = COLOR_TEMP_MARKER) {
    const {x, y} = relToCanvas(relX, relY, canvas);
    drawMarker(ctx, x, y, 8, color);
}

// == 14. Export & Download =============================================

/**
 * Exportiert alle Shots als XLSX (SheetJS) und speichert parallel einen Canvas-Screenshot (PNG).
 * Guard: Export-Button ist erst aktiv, wenn XLSX geladen; zusätzlicher Runtime-Check zur Sicherheit.
 */
function exportData() {
    /* --- Lokale Aliase aus dem CDN-Global ziehen (IDE-freundlich) ---
       JSDoc-Annotation @type {any} verhindert "Unresolved function/method" in der IDE,
       weil utils/json_to_sheet/... zur Laufzeit existieren, aber statisch nicht bekannt sind. */
    /** @type {any} */
    const xlsx = window.XLSX;
    /** @type {any} */
    const utils = xlsx && xlsx.utils;

    /* Guard: Bibliothek oder utils fehlen noch (z. B. sehr früher Klick) */
    if (!xlsx || !utils) {
        showToast('XLSX-Bibliothek lädt noch … bitte kurz warten', 'offline');
        return;
    }

    /* Keine Daten? */
    if (!shots.length) {
        alert('Keine Daten zum Exportieren.');
        return;
    }

    /* Dateisystemfreundlicher Zeitstempel */
    const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, '-');

    try {

        // Für den Export eine abgeleitete Spalte "goalSectorGK" anfügen
        const exportRows = shots.map(s => ({
            ...s,
            exactShotX: s.exactShotPos?.x ?? null,
            exactShotY: s.exactShotPos?.y ?? null,
            exactGoalX: s.exactGoalPos?.x ?? null,
            exactGoalY: s.exactGoalPos?.y ?? null,
            goalSectorGK: s.team !== 'rival'
                ? (() => {
                    // Für 7m mit gesetzter goalAreaId den konkreten Sektor spiegeln,
                    // nur bei "Quick-7m" ohne Sektor weiterhin "7m" exportieren.
                    const is7 = normalize(s.shotCategory ?? (shotAreaMap.get(s.shotAreaId)?.name ?? '')) === '7m';
                    const sectorOr7m = is7
                        ? (goalAreaMap.get(s.goalAreaId)?.name ?? '7m')
                        : (goalAreaMap.get(s.goalAreaId)?.name ?? '');
                    return mirrorGoalSector(sectorOr7m);
                })()
                : ''
        }));
        const sheet = utils.json_to_sheet(exportRows);

        const wb = utils.book_new();
        utils.book_append_sheet(wb, sheet, 'Shots');

        /* 2) XLSX als ArrayBuffer schreiben und herunterladen */
        const wBout = xlsx.write(wb, {bookType: 'xlsx', type: 'array'});
        const xlsxBlob = new Blob([wBout], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        triggerDownload(xlsxBlob, `SCM-Shots_${stamp}.xlsx`);
    } catch (err) {
        console.error('[Export] XLSX fehlgeschlagen:', err);
        alert('XLSX-Export fehlgeschlagen – siehe Konsole.');
    }

    /* 3) Canvas-Screenshot parallel speichern (PNG) – defensiv prüfen */
    if (canvas && canvas.toBlob) {
        canvas.toBlob(blob => {
            if (!blob) return;
            triggerDownload(blob, `SCM-ShotCanvas_${stamp}.png`);
        });
    }
}

/** Hilfsfunktion: erzeugt temporären Download-Link für Blob und klickt ihn programmgesteuert. */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
    }, 250);
}

// == 15. Service-Worker Lifecycle =======================================
/** Registriert den Service Worker und zeigt ein In-App-Update-Prompt, sobald eine neue Version bereitsteht. */
function initServiceWorkerLifecycle() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
        .register('src/sw/sw.js', {scope: 'src/sw/'})
        .then(reg => {
            if (reg.waiting) promptUserToUpdate(reg);
            reg.addEventListener('updatefound', () => {
                const newSW = reg.installing;
                if (newSW) {
                    newSW.addEventListener('statechange', () => {
                        if (newSW.state === 'installed' && reg.waiting) {
                            promptUserToUpdate(reg);
                        }
                    });
                }
            });
        })
        .catch(err => console.error('[SW] Registrierung fehlgeschlagen:', err));

    navigator.serviceWorker.addEventListener('controllerchange', () =>
        showToast('Update aktiv – Seite neu laden ✔', 'update')
    );
}

/** Ändert den jeweiligen Zähler um `delta` (niemals < 0), speichert und aktualisiert UI/Tabellen. */
async function changeAss(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    /* --------------------------------------------------------------
       1) Negative Klicks abfangen, *und* den Button sofort sperren.
    -------------------------------------------------------------- */
    if (delta < 0 && ass[gk][half] === 0) {
        const decBtn = document.getElementById('ass-decrement');
        if (decBtn) decBtn.disabled = true; // sofort „freeze“
        return;
    }

    /* 2) Wert anpassen (niemals < 0) */
    ass[gk][half] = Math.max(0, ass[gk][half] + delta);
    await setAss(ass); // persistieren

    /* 3) UI aktualisieren  ---------------------------------------- */
    updateAssBadge();
    renderGKStatTable();
}

/** Ändert den jeweiligen Zähler um `delta` (niemals < 0), speichert und aktualisiert UI/Tabellen. */
async function changeSevenG6(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    if (delta < 0 && sevenG6[gk][half] === 0) {
        const dec = document.getElementById('seven-g6-decrement');
        if (dec) dec.disabled = true;

        return;
    }

    sevenG6[gk][half] = Math.max(0, sevenG6[gk][half] + delta);
    await setSevenG6(sevenG6);
    updateSevenG6Badge();
    await updateLiveScore();
    renderGKStatTable();
    // ----- HT/FT live nachziehen -----
    await updateLiveScore(true);
}

/** Ändert den jeweiligen Zähler um `delta` (niemals < 0), speichert und aktualisiert UI/Tabellen. */
async function changeTor(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    if (delta < 0 && torCount[gk][half] === 0) {
        const dec = document.getElementById('tor-decrement');
        if (dec) dec.disabled = true;

        return;
    }

    torCount[gk][half] = Math.max(0, torCount[gk][half] + delta);
    await setTor(torCount);

    updateTorBadge();
    renderGKStatTable();
}

/** Ändert den jeweiligen Zähler um `delta` (niemals < 0), speichert und aktualisiert UI/Tabellen. */
async function changeTF(delta) {
    const gk = currentGoalkeeper;
    const half = currentHalf();

    if (delta < 0 && tfCount[gk][half] === 0) {
        const dec = document.getElementById('tf-decrement');
        if (dec) dec.disabled = true;

        return;
    }

    tfCount[gk][half] = Math.max(0, tfCount[gk][half] + delta);
    await setTF(tfCount);

    updateTFBadge();
    renderGKStatTable();
}

/** Zeigt Update-Toast; beim Klick sendet `SKIP_WAITING` an den wartenden SW und lädt danach neu. */
function promptUserToUpdate(reg) {
    const toast = showToast(
        'Update verfügbar – hier tippen, um neu zu laden',
        'update'
    );

    if (!toast) return;
    toast.addEventListener('click', () => {
        if (reg.waiting) {
            // Wartenden SW aktivieren
            reg.waiting.postMessage({type: 'SKIP_WAITING'});
            // und die Seite kurz danach neu laden (robust gegen minimale Aktivierungsverzögerung).
            setTimeout(() => {
                try {
                    window.location.reload();
                } catch {
                }
            }, 250);
        }
    });
}

// Ende src/js/app.js
