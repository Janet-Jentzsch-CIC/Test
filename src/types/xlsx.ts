// src/types/xlsx.ts
// --------------------------------------------------------------
// Macht das globale CDN-Objekt `XLSX` (SheetJS) für TypeScript
// und die IDE bekannt, obwohl es zur Laufzeit über <script>-Tag
// kommt. So verschwinden „Unresolved …“-Hinweise.
// --------------------------------------------------------------

export {}; // als ES-Modul markieren, damit `declare global` funktioniert

declare global {
    /** Globales CDN-Objekt (gleich `window.XLSX`) */
    const XLSX: typeof import('xlsx');

    interface Window {
        XLSX: typeof import('xlsx');
    }
}

// Ende src/types/xlsx.ts