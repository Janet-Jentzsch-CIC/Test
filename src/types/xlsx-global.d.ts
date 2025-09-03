// src/types/xlsx.d.ts
// --------------------------------------------------------------
// Minimaler Ambient-Typ für das globale CDN-Objekt `XLSX`.
// Deckt genau die Methoden ab, die in exportData() genutzt werden.
// --------------------------------------------------------------

export {}; // als ES-Modul markieren, damit `declare global` sauber ist

declare global {
    /** Minimales Subset von XLSX.utils, das wir verwenden */
    interface XLSXUtils {
        json_to_sheet(data: any[]): any;
        book_new(): any;
        book_append_sheet(workbook: any, worksheet: any, name: string): void;
    }

    /** Schreib-Optionen (auf das Nötigste reduziert) */
    interface XLSXWriteOptions {
        bookType: string; // z. B. 'xlsx'
        type: 'array' | 'binary' | 'buffer' | 'base64' | 'string';
    }

    /** Globales XLSX-Objekt (vom CDN-Script bereitgestellt) */
    interface XLSXStatic {
        utils: XLSXUtils;
        write(workbook: any, opts: XLSXWriteOptions): ArrayBuffer | Uint8Array | string;
    }

    /** Globale Variablen-Deklarationen */
    const XLSX: XLSXStatic;
    interface Window { XLSX: XLSXStatic; }
}
