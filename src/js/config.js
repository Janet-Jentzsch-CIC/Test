// =====================================================================
// src/js/config.js – Zentrale Zeichen-Parameter
// =====================================================================

// Füllung (0.0 = komplett durchsichtig, 1.0 = deckend)
export const ALPHA_SHOT_LEGACY = 0.05; // alte polygonale Wurfzonen (id ≤ 9)
export const ALPHA_SHOT_RECT   = 0.05; // rechteckige Wurfzonen (id ≥ 10)
export const ALPHA_GOAL_AREAS  = 0.05; // Torzonen (rechteckig)

// Kontur (Stroke)
export const ALPHA_STROKE_SHOT_LEGACY = 0.1;  // Kontur der alten Wurfzonen
export const ALPHA_STROKE_SHOT_RECT   = 0.6;  // Kontur der rechteckigen Wurfzonen
export const ALPHA_STROKE_GOAL_AREAS  = 0.3;  // Kontur der Torzonen

// Text/Labels bleiben deckend (1.0).

// Ende src/js/config.js