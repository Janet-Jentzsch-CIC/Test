// ============================================================================
//  src/js/canvasUtils.js
//  --------------------------------------------------------------------------
//  Hilfsroutinen für das Spielfeld-Canvas: Rendering, Hit-Testing sowie
//  Marker- und Textfunktionen.
//  Hinweis: Minuten-Ziffern werden separat mit drawText zentriert auf dem
//  Marker gerendert; drawMarker zeichnet ausschließlich den gefüllten Kreis.
// ============================================================================

/* --------------------------------------------------------------------------
   0) Konstanten
   ------------------------------------------------------------------------ */
const OUTER_ARC_FACTOR = 0.6557; // Radius-Faktor für RL / RR-Bögen
const DIAG_ARC_FACTOR = 1.475; // etwas größer für DL / DR-Halbkreise

/* ========================================================================
   Helper: zeichnet den Legacy-Pfad (identisch für Render & Hit-Test)
   ===================================================================== */
function traceLegacyPath(ctx, area, w, h) {
    const rel = (rx, ry) => ({x: rx * w, y: ry * h});
    const gL = {x: 0.425, y: 0.27};
    const gR = {x: 0.575, y: 0.27};

    const tri = (a) => {
        const p1 = rel(a.coords.x1, a.coords.y1);
        const p2 = rel(a.coords.x2, a.coords.y2);
        const p3 = rel(a.coords.x3, a.coords.y3);
        path([p1, p2, p3]);
    };

    const quad = (a) => {
        const p1 = rel(a.coords.x1, a.coords.y1);
        const p2 = rel(a.coords.x2, a.coords.y2);
        const p3 = rel(a.coords.x3, a.coords.y3);
        const p4 = rel(a.coords.x4, a.coords.y4);
        path([p1, p2, p3, p4]);
    };

    const km = () => {
        const p1 = rel(area.coords.x1, area.coords.y1);
        const p2 = rel(area.coords.x2, area.coords.y2);
        const p4 = rel(area.coords.x4, area.coords.y4);
        const rL = p4.y - rel(gL.x, gL.y).y;
        const rR = p4.y - rel(gR.x, gR.y).y;

        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.arc(rel(gL.x, gL.y).x, rel(gL.x, gL.y).y,
            rL, Math.PI - 0.6, Math.PI / 2 + 0.1, true);
        ctx.lineTo(p4.x, p4.y);
        ctx.arc(rel(gR.x, gR.y).x, rel(gR.x, gR.y).y,
            rR, Math.PI / 2 - 0.1, 0.6, true);
        ctx.closePath();
    };

    const dlDr = () => {
        const p1 = rel(area.coords.x1, area.coords.y1);
        const p3 = rel(area.coords.x3, area.coords.y3);
        const goal = area.id === 4 ? rel(gL.x, gL.y) : rel(gR.x, gR.y);
        const rO = DIAG_ARC_FACTOR * (p3.y - goal.y);
        const rI = (p3.y - goal.y);

        ctx.moveTo(p1.x, p1.y);
        if (area.id === 4) {
            ctx.arc(goal.x, goal.y, rO, Math.PI - 0.56, Math.PI / 2 + 0.10, true);
            ctx.lineTo(p3.x, p3.y);
            ctx.arc(goal.x, goal.y, rI, Math.PI / 2, Math.PI - 0.60, false);
        } else {
            ctx.arc(goal.x, goal.y, rO, 0.56, Math.PI / 2 - 0.10, false);
            ctx.lineTo(p3.x, p3.y);
            ctx.arc(goal.x, goal.y, rI, Math.PI / 2, 0.60, true);
        }
        ctx.closePath();
    };

    const rlRr = (isLeft) => {
        const p1 = rel(area.coords.x1, area.coords.y1);
        const p2 = rel(area.coords.x2, area.coords.y2);
        const p3 = rel(area.coords.x3, area.coords.y3);
        const baseY = p2.y;
        const goal = isLeft ? rel(gL.x, gL.y) : rel(gR.x, gR.y);
        const r = OUTER_ARC_FACTOR * (p3.y - goal.y);

        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p2.x, baseY);
        ctx.lineTo(p3.x, baseY);
        ctx.lineTo(p3.x, p3.y);
        ctx.arc(goal.x, goal.y, r,
            isLeft ? Math.PI / 2 + 0.10 : Math.PI / 2 - 0.10,
            isLeft ? Math.PI - 0.56 : 0.56,
            !isLeft);
        ctx.closePath();
    };

    const path = (pts) => {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
    };

    ctx.beginPath();
    switch (area.id) {
        case 1:
        case 3:
            tri(area);
            break;
        case 2:
            km();
            break;
        case 4:
        case 5:
            dlDr();
            break;
        case 7:
            rlRr(true);
            break;
        case 8:
            rlRr(false);
            break;
        case 6:
        case 9:
            quad(area);
            break;
        default:
            ctx.beginPath();
    }
}

/* ========================================================================
   2) Haupt-Renderer (Legacy-Geometrie)
   ===================================================================== */
// 2) Haupt-Renderer (Legacy-Geometrie)
export function drawShotAreaLegacy(ctx, area, w, h, fillAlpha = 0.35, strokeAlpha = 1) {
    ctx.save();

    // Fläche + Kontur zeichnen (identisch zum Hit-Test-Pfad)
    traceLegacyPath(ctx, area, w, h);

    // --- Füllung halbtransparent ------------------------------------
    ctx.globalAlpha = fillAlpha;   // ← Füll-Transparenz
    ctx.fillStyle = area.color;
    ctx.fill();

    // --- Kontur separat steuern -------------------------------------
    ctx.globalAlpha = strokeAlpha; // ← Kontur-Transparenz
    ctx.strokeStyle = area.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Label/Text immer deckend -----------------------------------
    const rel = (rx, ry) => ({ x: rx * w, y: ry * h });
    const labelCenters = {
        1:{x:0.16,y:0.35}, 2:{x:0.50,y:0.44}, 3:{x:0.84,y:0.35},
        4:{x:0.21,y:0.54}, 5:{x:0.79,y:0.54}, 6:{x:0.50,y:0.67},
        7:{x:0.21,y:0.72}, 8:{x:0.79,y:0.72}, 9:{x:0.50,y:0.88}
    };
    const relCenter = labelCenters[area.id];
    const center = relCenter ? rel(relCenter.x, relCenter.y) : areaCenter(area.coords);

    ctx.globalAlpha = 1;         // ← wichtig: Label deckend
    ctx.fillStyle = '#000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(area.name, center.x, center.y);

    ctx.restore();

    function areaCenter(coords) {
        const pts = [];
        for (let i = 1; coords['x' + i] != null; i++) pts.push(rel(coords['x' + i], coords['y' + i]));
        const sx = pts.reduce((s, p) => s + p.x, 0);
        const sy = pts.reduce((s, p) => s + p.y, 0);
        return { x: sx / pts.length, y: sy / pts.length };
    }
}

/* ========================================================================
   3) Hit-Test – identische Pfade wie beim Zeichnen
   ===================================================================== */
export function isPointInShotAreaLegacy(area, px, py) {
    const w = window.canvasWidth, h = window.canvasHeight;
    if (!w || !h) return false;

    if (!isPointInShotAreaLegacy.__ctx) {
        const off = document.createElement('canvas');
        isPointInShotAreaLegacy.__ctx = off.getContext('2d');
    }
    const ctx = isPointInShotAreaLegacy.__ctx;

    // resize if needed
    if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
        ctx.canvas.width = w; ctx.canvas.height = h;
    }

    ctx.save();                           // ← Kontextzustand sichern
    // (optional) sicherheitshalber die Transformationsmatrix zurücksetzen:
    // ctx.setTransform(1, 0, 0, 1, 0, 0);
    traceLegacyPath(ctx, area, w, h);     // denselben Pfad wie beim Rendern erstellen
    const hit = ctx.isPointInPath(px, py);
    ctx.beginPath();                      // Pfad leeren, um keine Ansammlung zu verursachen
    ctx.restore();                        // Stile/Alpha/Clip wiederherstellen
    return hit;
}

/* ========================================================================
   4) Weitere Canvas-Utils
   ===================================================================== */

/**
 * Zeichnet einen einfachen Kreis-Marker (fill) an Position (x, y) mit Radius r
 * und Farbe color. Prüft nicht auf Textärkung; GlobalAlpha ist gesetzt.
 */
export function drawMarker(ctx, x, y, r = 10, color = '#FF0') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();
}

// rechnet rel-Koordinaten auf Basis der *aktuell gerenderten*
// CSS-Größe des Canvas in Pixel um. Verhindert Drift bei Zoom/DPI.
export function relToCanvas(relX, relY, canvas) {
    const r = canvas.getBoundingClientRect();
    return {
        x: Math.round(relX * r.width),
        y: Math.round(relY * r.height)
    };
}

/**
 * Prüft, ob ein Punkt p={x,y} innerhalb eines Polygons poly liegt.
 * Poly ist ein Array von {x,y}-Punkten. (Ray-Casting-Algorithmus)
 */
export function isPointInPolygon(poly, p) {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const inter = ((yi > p.y) !== (yj > p.y))
            && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
        if (inter) ins = !ins;
    }
    return ins;
}

export function drawText(
    ctx,
    text,
    x,
    y,
    font = 'normal 14px Arial',
    fill = '#000',
    stroke = 'rgba(255,255,255,0.76)'
) {
    ctx.save();

    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* 1) weiße Kontur – macht Ziffern auf dunklem Hintergrund klarer */
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);

    /* 2) eigentliche Füllung */
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);

    ctx.restore();
}

// Ende src/js/canvasUtils.js
