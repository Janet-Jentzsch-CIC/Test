/*  -------------------------------------------------------------------------
    src/js/header.js – Kopfbereich (Match-Infos) der PWA
    -------------------------------------------------------------------------
    - Rendert ein CSS-Grid mit Match-Infos
      (Wettbewerb · Datum · Ort · Gegner · TWs · HT/FT).
    - Alle Eingaben werden unmittelbar in IndexedDB persistiert.
    - Beim Laden werden gespeicherte Werte initialisiert.
    - Leichtgewichtiger Kalender-Picker ohne externe Bibliotheken.
    ---------------------------------------------------------------------- */

import {getMatchInfo, initDB, setMatchInfo} from "./db.js";

/* ===== 1. Hilfsfunktionen ================================================= */

/**
 * Erzeugt ein <input>-Feld (optional mit Datalist zur Autovervollständigung).
 * @param {string} placeholder - Platzhaltertext im Input
 * @param {string[]} options - Listeneinträge für <datalist>
 * @param {string} width - CSS-Breite (z. B. "100%", "60px"); leer = keine Vorgabe
 * @param {string} defaultValue - Startwert
 * @param {string} id - optionale ID (wichtig für Label-Kopplung)
 */
function createInputCell(
    placeholder,
    options = [],
    width = "100%",
    defaultValue = "",
    id = ""
) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = placeholder;
    if (width) inp.style.width = width; // Nur setzen, wenn vom Aufrufer gewünscht
    if (id) inp.id = id;
    if (defaultValue) inp.value = defaultValue;

    // Optionale Datalist für bekannte Werte (Autocomplete)
    if (options.length) {
        const dl = document.createElement("datalist");
        const base = (id || placeholder).toLowerCase().replace(/[^\w-]+/g, "-");
        dl.id = `dl-${base}`;
        options.forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o;
            dl.appendChild(opt);
        });
        // Datalist global an <body> hängen – so ist sie unabhängig vom Grid.
        document.body.appendChild(dl);
        inp.setAttribute("list", dl.id);
    }
    return inp;
}

/**
 * Formatiert ein Date-Objekt als "DD.MM.YYYY".
 */
function formatDateGerman(date) {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = date.getFullYear();
    return `${dd}.${mm}.${yy}`;
}

/**
 * Robustes Parsen eines "DD.MM.YYYY"-Strings zu Date.
 * Gibt null zurück, wenn das Datum syntaktisch oder kalendarisch ungültig ist.
 */
function parseDateGerman(str) {
    const m = String(str || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    const dd = +m[1],
        mm = +m[2],
        yyyy = +m[3];
    const d = new Date(yyyy, mm - 1, dd);
    // Validitätscheck: z. B. 31.02. ist ungültig
    return d.getFullYear() === yyyy &&
    d.getMonth() === mm - 1 &&
    d.getDate() === dd
        ? d
        : null;
}

/* ============================================================================
 *  Leichtgewichtiger Kalender (kein <input type="date">, um Masken/Pattern
 *  beizubehalten und auf allen Geräten einheitlich zu wirken).
 *  - Öffnen via Icon oder Fokus
 *  - Auswahl schreibt DD.MM.YYYY ins Feld und persistiert sofort
 *  - 'change'-Event wird bewusst gefeuert (bestehender Flow bleibt intakt)
 *  - ESC/Outside-Click schließt; Buttons "Heute" / "Leeren"
 * ==========================================================================*/
function attachDatePicker(dateInput) {
    if (!dateInput) return;

    /* ---------------- CSS einmalig injizieren (scoped Klassen) -------------- */
    if (!document.getElementById("gk-dp-style")) {
        const css = document.createElement("style");
        css.id = "gk-dp-style";
        css.textContent = `
  .dp-wrap{position:relative;display:inline-block;width:100%}
  .dp-input{width:100%;padding-right:30px}
  .dp-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);
             width:45px;height:45px;border:0;background:transparent;cursor:pointer}
  .dp-toggle:before{content:"📅";font-size:16px;line-height:22px;display:block;opacity:.9}

  .dp-pop{
    position:fixed;z-index:99999;min-width:260px;background:#fff;border:1px solid #ddd;
    border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:8px;
    color:#111;
  }
  .dp-head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 10px}
  .dp-title{font-weight:700;color:#111}
  .dp-nav{display:flex;gap:6px}
  .dp-nav button{border:1px solid #ddd;background:#f6f6f6;border-radius:4px;padding:2px 6px;cursor:pointer}

  .dp-grid{display:grid;grid-template-columns:repeat(7,32px);grid-auto-rows:32px;gap:2px;justify-content:center;padding:6px}

  .dp-dow{
    font-size:.75rem;text-align:center;line-height:32px;
    font-weight:600;color:#444;
  }

  .dp-day{border:1px solid transparent;border-radius:6px;text-align:center;line-height:30px;cursor:pointer;color:#111}
  .dp-day:hover{background:#f0f6ff;border-color:#cfe3ff}
  .dp-day.is-today{outline:1px solid #78aaff}
  .dp-day.is-selected{background:#1976d2;color:#fff;border-color:#1976d2}

  .dp-foot{display:flex;justify-content:space-between;padding:6px 8px 4px}
  .dp-foot button{background:none;border:0;color:#1976d2;cursor:pointer;padding:4px 6px;border-radius:4px}
  .dp-foot button:hover{background:#eaf3ff}

  @media (prefers-color-scheme: dark){
    .dp-pop{background:#1f1f1f;border-color:#333;box-shadow:0 8px 24px rgba(0,0,0,.6);color:#eee}
    .dp-title{color:#fff}
    .dp-nav button{background:#2a2a2a;border-color:#444;color:#ddd}
    .dp-day{color:#eaeaea}
    .dp-day:hover{background:#2a3140;border-color:#3a4b66}
    .dp-day.is-selected{background:#3a78d2;border-color:#3a78d2}
    .dp-dow{color:#cfd8e3}
    .dp-foot button{color:#8ab6ff}
  }
`;
        document.head.appendChild(css);
    }

    /* ---------------- Input in Wrapper legen + Toggle-Button ---------------- */
    const wrap = document.createElement("div");
    wrap.className = "dp-wrap";
    dateInput.classList.add("dp-input");
    dateInput.parentNode.insertBefore(wrap, dateInput);
    wrap.appendChild(dateInput);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "dp-toggle";
    toggleBtn.setAttribute("aria-label", "Kalender öffnen");
    // A11y: deklarieren, dass ein Dialog aufgeht und den Zustand pflegen
    toggleBtn.setAttribute("aria-haspopup", "dialog");
    toggleBtn.setAttribute("aria-expanded", "false");
    wrap.appendChild(toggleBtn);

    /* ---------------- Popup-Container im Body (für sauberes Positionieren) -- */
    const pop = document.createElement("div");
    pop.className = "dp-pop";
    pop.hidden = true;
    // A11y: semantischer Dialog
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Datum auswählen");
    document.body.appendChild(pop);

    /* ---- State: sichtbarer Monat/Jahr, aktuell ausgewähltes Datum ---------- */
    let view = parseDateGerman(dateInput.value) || new Date();
    let selected = parseDateGerman(dateInput.value);

    // Deutsche Monats- und Wochentagsnamen (Start der Woche = Montag)
    const MONTHS = [
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ];
    const DOW = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    const FIRST_DAY = 1; // 1 = Montag

    /* ---------------- Kleine Helfer ---------------------------------------- */
    const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const sameDay = (a, b) =>
        a &&
        b &&
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
    const today = () => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
    };

    /* ---------------- Rendering des Kalenders ------------------------------- */
    function render() {
        pop.innerHTML = "";

        // Kopf mit Monat/Jahr und Navigation
        const head = document.createElement("div");
        head.className = "dp-head";

        const title = document.createElement("div");
        title.className = "dp-title";
        title.textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;

        const nav = document.createElement("div");
        nav.className = "dp-nav";
        const prev = document.createElement("button");
        prev.textContent = "◀";
        prev.setAttribute("aria-label", "Voriger Monat");
        const next = document.createElement("button");
        next.textContent = "▶";
        next.setAttribute("aria-label", "Nächster Monat");
        prev.addEventListener("click", () => {
            view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
            render();
        });
        next.addEventListener("click", () => {
            view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
            render();
        });
        nav.append(prev, next);

        head.append(title, nav);
        pop.appendChild(head);

        // Grid (Wochentagsköpfe + Tage)
        const grid = document.createElement("div");
        grid.className = "dp-grid";

        // Wochentage (Mo–So)
        DOW.forEach((lbl) => {
            const c = document.createElement("div");
            c.className = "dp-dow";
            c.textContent = lbl;
            grid.appendChild(c);
        });

        // Offset ermitteln (Erster Tag des Monats relativ zum Wochenstart)
        const first = startOfMonth(view);
        let dow = first.getDay(); // 0=So … 6=Sa
        if (dow === 0) dow = 7;
        const offset = (dow - FIRST_DAY + 7) % 7;

        const last = endOfMonth(view).getDate();

        // Leere Felder vor Tag 1 (für korrekte Spaltenausrichtung)
        for (let i = 0; i < offset; i++) {
            grid.appendChild(document.createElement("div"));
        }

        // Einzeltage als Buttons (tastaturbedienbar) rendern
        for (let day = 1; day <= last; day++) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "dp-day";
            btn.textContent = String(day);
            const cur = new Date(view.getFullYear(), view.getMonth(), day);

            if (sameDay(cur, today())) btn.classList.add("is-today");
            if (selected && sameDay(cur, selected)) btn.classList.add("is-selected");

            btn.addEventListener("click", () => {
                selected = cur;
                // Wert formatieren & ins Feld schreiben
                dateInput.value = formatDateGerman(cur);

                // Sofort persistieren (IndexedDB) + 'change' feuern (Downstream-Listener)
                try {
                    setMatchInfo("date", dateInput.value);
                } catch {
                }
                dateInput.dispatchEvent(new Event("change", {bubbles: true}));

                close();
            });

            grid.appendChild(btn);
        }

        pop.appendChild(grid);

        // Fußleiste: Leeren / Heute
        const foot = document.createElement("div");
        foot.className = "dp-foot";
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.textContent = "Leeren";
        clearBtn.addEventListener("click", () => {
            dateInput.value = "";
            try {
                setMatchInfo("date", "");
            } catch {
            }
            dateInput.dispatchEvent(new Event("change", {bubbles: true}));
            close();
        });

        const todayBtn = document.createElement("button");
        todayBtn.type = "button";
        todayBtn.textContent = "Heute";
        todayBtn.addEventListener("click", () => {
            const t = today();
            selected = t;
            view = new Date(t.getFullYear(), t.getMonth(), 1);
            dateInput.value = formatDateGerman(t);
            try {
                setMatchInfo("date", dateInput.value);
            } catch {
            }
            dateInput.dispatchEvent(new Event("change", {bubbles: true}));
            close();
        });

        foot.append(clearBtn, todayBtn);
        pop.appendChild(foot);
    }

    /* ---------------- Öffnen/Schließen + Positionierung --------------------- */
    let outsideHandler = null;
    let escHandler = null;

    function open() {
        if (!pop.hidden) return;

        // Sicht an Feldwert ausrichten, falls vorhanden
        selected = parseDateGerman(dateInput.value);
        view = selected
            ? new Date(selected.getFullYear(), selected.getMonth(), 1)
            : new Date();

        render();
        pop.hidden = false;
        toggleBtn.setAttribute("aria-expanded", "true");

        // Position knapp unter dem Input (fixed -> stabil beim Scrollen)
        const r = dateInput.getBoundingClientRect();
        const top = Math.round(r.bottom + 4);
        const tentativeLeft = r.left;
        pop.style.top = `${top}px`;
        // Rechtskante absichern, damit Popover nicht aus dem Viewport läuft
        pop.style.left = `${Math.max(
            8,
            Math.min(tentativeLeft, window.innerWidth - pop.offsetWidth - 8)
        )}px`;

        // Outside/ESC-Handhabung – Capture-Phase, damit auch bei
        // stopPropagation() in Unterelementen zuverlässig geschlossen wird.
        outsideHandler = (e) => {
            if (
                !pop.contains(e.target) &&
                e.target !== toggleBtn &&
                e.target !== dateInput
            )
                close();
        };
        escHandler = (e) => {
            if (e.key === "Escape") close();
        };

        // Listener erst im nächsten Frame setzen, damit Popover im DOM „steht“.
        requestAnimationFrame(() => {
            document.addEventListener("mousedown", outsideHandler, {capture: true});
            document.addEventListener("keydown", escHandler, {capture: true});
            window.addEventListener("resize", close, {once: true});
            window.addEventListener("scroll", close, {once: true, passive: true});
        });
    }

    function close() {
        if (pop.hidden) return;
        pop.hidden = true;
        toggleBtn.setAttribute("aria-expanded", "false");
        // Hinweis: removeEventListener beachtet beim dritten Argument v. a. 'capture'
        document.removeEventListener("mousedown", outsideHandler, {
            capture: true,
        });
        document.removeEventListener("keydown", escHandler, {capture: true});
        outsideHandler = escHandler = null;
    }

    /* ---------------- Bindings: Icon, Fokus, Tastatur ----------------------- */
    toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        pop.hidden ? open() : close();
    });
    // Öffnet bei Fokus – auf Mobilgeräten sehr praktisch
    dateInput.addEventListener("focus", () => open());
    // Optional: Alt+↓ öffnet, Alt+↑ schließt
    dateInput.addEventListener("keydown", (e) => {
        if (e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            open();
        }
        if (e.altKey && e.key === "ArrowUp") {
            e.preventDefault();
            close();
        }
    });
}

/* =====================================================================
 *  2. Initialisierung – DOMContentLoaded (ein Listener für alles)
 * ===================================================================*/
document.addEventListener("DOMContentLoaded", async () => {
    /* --------------------------------------------------
     *  Theme-Switcher (Light | Auto | Dark)
     *  - Speicherung in localStorage
     *  - 'auto' delegiert an OS-Theme
     * -------------------------------------------------- */
    const themeModes = ["light", "auto", "dark"];

    function applyTheme(mode = "auto") {
        const html = document.documentElement;
        if (mode === "auto") {
            html.removeAttribute("data-theme"); // OS entscheidet
        } else {
            html.setAttribute("data-theme", mode); // 'light' | 'dark'
        }
        localStorage.themeMode = mode;
        // Sliderposition synchron halten (nur kosmetisch)
        const idx = themeModes.indexOf(mode);
        document.getElementById("theme-slider")?.setAttribute("data-pos", idx);
    }

    // Schmaler UI-Baustein für die Timer-Leiste
    const makeThemeSlider = () => {
        const wrap = document.createElement("div");
        wrap.className = "theme-switcher";
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "8px";

        // Labels + „Slot“ für den Slider
        const lbls = ["Hell", "Dunkel"];
        let sliderSlot = null;
        lbls.forEach((t, i) => {
            const l = document.createElement("span");
            l.textContent = t;
            l.style.fontSize = ".7rem";
            if (i === 1) l.style.flex = "0 0 auto";
            wrap.appendChild(l);

            const sep = document.createElement("div");
            sep.style.flex = "1 1 8px";
            wrap.appendChild(sep);
            if (i === 0 && !sliderSlot) sliderSlot = sep; // erster Trenner = Slot
        });

        // Range-Slider (0=light, 1=auto, 2=dark)
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = 0;
        slider.max = 2;
        slider.step = 1;
        slider.id = "theme-slider";
        slider.style.width = "110px";
        slider.value = themeModes.indexOf(localStorage.themeMode || "auto");
        slider.addEventListener("input", (e) => {
            applyTheme(themeModes[Number(e.target.value)]);
        });

        (sliderSlot ?? wrap).appendChild(slider);
        return wrap;
    };

    // In die Timer-Leiste hängen (wenn vorhanden)
    document.querySelector(".timer-container")?.appendChild(makeThemeSlider());

    // Theme initial anwenden
    applyTheme(localStorage.themeMode || "auto");

    /* --------------------- IndexedDB-Bootstrap ---------------------- */
    // DB initialisieren (einmalig) und mind. den Key 'team' anlegen.
    const db = await initDB();
    {
        const tx = db.transaction("matchInfo", "readwrite");
        const store = tx.store;
        if (!(await store.get("team"))) {
            await store.put({id: "team", value: ""});
        }
        await tx.done;
    }

    // Gespeicherte Werte abrufen und Inputs initial befüllen
    const matchInfo = await getMatchInfo();

    /* --------------------- GK-Inputs (Name & Nummer) -------------------- */
    const gk1NameInput = createInputCell(
        "Name",
        [],
        "",
        matchInfo.gk1Name || "",
        "gk1-name-input"
    );
    const gk1NumberInput = createInputCell(
        "Nr",
        [],
        "",
        matchInfo.gk1Number || "",
        "gk1-number-input"
    );
    const gk2NameInput = createInputCell(
        "Name",
        [],
        "",
        matchInfo.gk2Name || "",
        "gk2-name-input"
    );
    const gk2NumberInput = createInputCell(
        "Nr",
        [],
        "",
        matchInfo.gk2Number || "",
        "gk2-number-input"
    );

    // Basisklassen für Styling/Größen
    gk1NameInput.classList.add("input--name");
    gk2NameInput.classList.add("input--name");
    gk1NumberInput.classList.add("input--nr");
    gk2NumberInput.classList.add("input--nr");

    // Nummernfelder auf 1–2 Ziffern begrenzen (UX + Mobile-Keyboard)
    [gk1NumberInput, gk2NumberInput].forEach((inpNr) => {
        inpNr.inputMode = "numeric";
        inpNr.pattern = "\\d{1,2}";
        inpNr.maxLength = 2;
        inpNr.autocomplete = "off";
    });

    /* GK-Metadaten an app.js melden (Badges/Tabellen live updaten) */
    function emitGKMetaChange() {
        const parseNr = (el) => {
            const n = parseInt(el.value, 10);
            return Number.isFinite(n) ? n : null; // robust bei leer/ungültig
        };

        const detail = {
            gk1: {name: gk1NameInput.value.trim(), number: parseNr(gk1NumberInput)},
            gk2: {name: gk2NameInput.value.trim(), number: parseNr(gk2NumberInput)},
        };

        window.dispatchEvent(new CustomEvent("gk-meta-change", {detail}));
    }

    /* --------------------- Allgemeine Input-Felder ------------------------- */
    const teamInput = createInputCell(
        "Team",
        ["1. Mannschaft", "Youngsters", "A-Jugend"],
        "",
        matchInfo.team || "",
        "team-input"
    );
    const competitionInput = createInputCell(
        "Wettbewerb",
        ["Bundesliga", "Pokal", "Europapokal", "Super Globe", "3. Liga", "Testspiel"],
        "",
        matchInfo.competition || "",
        "competition-input"
    );
    const dateInput = createInputCell(
        "TT.MM.JJJJ",
        [],
        "",
        matchInfo.date || formatDateGerman(new Date()),
        "date-input"
    );
    const locationInput = createInputCell(
        "Ort / Halle",
        ["Magdeburg"],
        "",
        matchInfo.location || "",
        "location-input"
    );
    const opponentInput = createInputCell(
        "Gegner",
        [],
        "",
        matchInfo.opponent || "",
        "opponent-input"
    );

    // Klassen für Breiten-/Layoutsteuerung im Grid
    teamInput.classList.add("input--team");
    competitionInput.classList.add("input--wettb");
    dateInput.classList.add("input--date");
    locationInput.classList.add("input--ort");
    opponentInput.classList.add("input--gegner");

    // Datum: numerisches Keyboard + Validation (TT.MM.JJJJ)
    dateInput.inputMode = "numeric";
    dateInput.pattern = "^\\d{2}\\.\\d{2}\\.\\d{4}$";
    dateInput.maxLength = 10;
    dateInput.autocomplete = "off";

    // HT/FT-Eingaben (schmale Felder)
    const halftimeInput = createInputCell(
        "Halbzeit",
        [],
        "60px",
        matchInfo.halftime || "",
        "halftime-input"
    );
    const fulltimeInput = createInputCell(
        "Endstand",
        [],
        "60px",
        matchInfo.fulltime || "",
        "fulltime-input"
    );

    /* --------------------- Score-Block (HT/FT) ------------------------------ */
    const scoreBlock = (() => {
        const wrap = document.createElement("div");
        wrap.className = "score-block";
        const mkGroup = (lbl, inp) => {
            const g = document.createElement("div");
            g.className = "score-input-group";
            // Label ist konstant (kein User-Input) -> innerHTML OK
            g.innerHTML = `<label>${lbl}</label>`;
            g.appendChild(inp);
            return g;
        };
        wrap.appendChild(mkGroup("HT", halftimeInput));
        wrap.appendChild(mkGroup("FT", fulltimeInput));
        return wrap;
    })();

    /* =====================================================================
     *  Grid-Builder für den Header
     *  - 10 Spalten = 5 Label|Input-Paare pro Zeile
     *  - Trikot-Nr bleibt fix 60px breit
     *  - fit-content(ch) sorgt für harmonische max-Breiten der Eingaben
     * ===================================================================*/
    function createHeaderGrid(containerId, rows) {
        const host = document.getElementById(containerId);
        if (!host) {
            console.error(`[header] Container "${containerId}" nicht gefunden`);
            return;
        }

        const grid = document.createElement("div");
        grid.className = "header-info-grid";
        Object.assign(grid.style, {
            display: "grid",
            // Label | Feld | Label | Feld | Label | Feld | Label | Nr(60px) | Label | Feld
            gridTemplateColumns:
                "max-content fit-content(24ch) max-content fit-content(24ch) max-content fit-content(22ch) max-content 60px max-content fit-content(28ch)",
            columnGap: "12px",
            rowGap: "10px",
            alignItems: "center",
            width: "100%",
        });

        // Laufende ID-Vergabe für Inputs ohne id (wichtig für <label for>)
        let autoId = 0;
        const ensureId = (el) => {
            if (!el.id) el.id = `hdr-inp-${++autoId}`;
            return el.id;
        };

        // Label-Factory: semantisch korrekt mit 'for', optisch rechtsbündig
        const makeLabel = (text, forId = null) => {
            const l = document.createElement("label");
            l.textContent = text;
            if (forId) l.htmlFor = forId;
            l.style.justifySelf = "end";
            l.style.whiteSpace = "nowrap";
            l.style.textAlign = "right";
            return l;
        };

        // Anzahl Spalten dynamisch aus Template ermitteln
        const colCount = grid.style.gridTemplateColumns.split(/\s+/).length;

        rows.forEach((cells) => {
            for (let i = 0; i < colCount; i++) {
                const cell = cells[i];

                // Leere Zelle als Platzhalter (hält Grid-Struktur stabil)
                if (cell == null || cell === "") {
                    grid.appendChild(document.createElement("div"));
                    continue;
                }

                // String -> Label rendern und (falls direkt folgend) an Input koppeln
                if (typeof cell === "string") {
                    const next = cells[i + 1];
                    let forId = null;
                    if (next instanceof HTMLElement && next.tagName === "INPUT") {
                        forId = ensureId(next);
                    }
                    grid.appendChild(makeLabel(cell, forId));
                    continue;
                }

                // HTMLElement (Input etc.) direkt einfügen
                if (cell instanceof HTMLElement) {
                    grid.appendChild(cell);
                    continue;
                }

                // Fallback (unbekannter Typ)
                grid.appendChild(document.createElement("div"));
            }
        });

        host.appendChild(grid);
    }

    /* --------------------- Grid-Inhalte (2 Zeilen) -------------------------- */
    createHeaderGrid("information-container", [
        [
            "SCM –",
            opponentInput,
            "Dat.",
            dateInput,
            "TW 1",
            gk1NameInput,
            "Nr.",
            gk1NumberInput,
            "Wettb.",
            competitionInput,
        ],
        [
            "Team",
            teamInput,
            "Ort",
            locationInput,
            "TW 2",
            gk2NameInput,
            "Nr.",
            gk2NumberInput,
            "",
            "",
        ],
    ]);

    /* Kalender an das Datumsfeld hängen (Popup + Sofort-Persist) */
    attachDatePicker(dateInput);

    /* Score-Block neben dem Timer platzieren */
    document.querySelector(".timer-container")?.appendChild(scoreBlock);

    /* --------------------- Change-Listener (generisch) ---------------------- */
    // Persistiert den Wert eines Inputs unter dem angegebenen Key.
    const persist = (key) => (e) => setMatchInfo(key, e.currentTarget.value);

    teamInput.addEventListener("change", persist("team"));
    competitionInput.addEventListener("change", persist("competition"));
    dateInput.addEventListener("change", persist("date"));
    locationInput.addEventListener("change", persist("location"));
    opponentInput.addEventListener("change", persist("opponent"));
    halftimeInput.addEventListener("change", persist("halftime"));
    fulltimeInput.addEventListener("change", persist("fulltime"));

    /* --------------------- GK-Change-Listener ------------------------------- */
    // Variante für GK: speichert und triggert zusätzlich gk-meta-change (UI-Updates).
    const persistGK = (key) => (e) => {
        setMatchInfo(key, e.currentTarget.value);
        emitGKMetaChange();
    };

    gk1NameInput.addEventListener("change", persistGK("gk1Name"));
    gk1NumberInput.addEventListener("change", persistGK("gk1Number"));
    gk2NameInput.addEventListener("change", persistGK("gk2Name"));
    gk2NumberInput.addEventListener("change", persistGK("gk2Number"));

    // Beim ersten Laden sofort Event feuern, damit abhängige Komponenten
    // (Badges/Tabellen) ohne manuelle Aktion des Nutzers korrekt sind.
    emitGKMetaChange();
});

// Ende src/js/header.js
