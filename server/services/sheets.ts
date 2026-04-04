import fs from 'fs';
import path from 'path';
import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';

export type SheetData = Record<string, string>;

let sheetCache: Map<string, SheetData[]> = new Map();
let systemPromptCache: string | null = null;

let resolveReady: () => void;
export const dataReadyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
});

/**
 * Maps spreadsheet rows to objects using the first row as keys.
 * Converts column names to snake_case for consistency.
 */
export function mapRowsToObjects(header: string[], rows: string[][]): SheetData[] {
    return rows.map((row) => {
        const obj: SheetData = {};
        header.forEach((key, index) => {
            if (!key) return;
            const safeKey = key
                .trim()
                .replace(/([a-z])([A-Z])/g, '$1_$2')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
            obj[safeKey] = row[index] || '';
        });
        return obj;
    });
}

async function getSheetsClient(): Promise<sheets_v4.Sheets> {
    const localKeyName = 'google-key.json';
    const absoluteKeyPath = path.join(process.cwd(), localKeyName);
    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
    
    let keyFile: string | undefined = undefined;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else if (fs.existsSync(absoluteKeyPath)) {
        try {
            const stats = fs.statSync(absoluteKeyPath);
            if (stats.size > 0) {
                keyFile = absoluteKeyPath;
            }
        } catch (e) {
            console.warn(`Could not read local key file ${localKeyName}:`, e);
        }
    }

    const auth = new google.auth.GoogleAuth({
        scopes,
        keyFile,
    });

    return google.sheets({ version: 'v4', auth });
}

/**
 * Fetches all sheets and populates the cache.
 * 'prompt' sheet is handled separately.
 */
export async function fetchAllSheets(): Promise<void> {
    if (!config.googleSheetsId) {
        console.warn("GOOGLE_SHEETS_ID is not set.");
        resolveReady();
        return;
    }

    try {
        const sheets = await getSheetsClient();
        
        // 1. Get spreadsheet metadata to list all sheet names
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: config.googleSheetsId,
        });

        const sheetNames = spreadsheet.data.sheets
            ?.map(s => s.properties?.title)
            .filter((name): name is string => !!name && !name.toLowerCase().startsWith('wip')) || [];

        const newCache = new Map<string, SheetData[]>();

        // 2. Fetch data for each sheet in parallel
        await Promise.all(sheetNames.map(async (name) => {
            try {
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: config.googleSheetsId,
                    range: `${name}!A1:Z`,
                });

                const allValues = response.data.values;
                if (!allValues || allValues.length < 1) {
                    if (name === 'prompt') systemPromptCache = "";
                    else newCache.set(name, []);
                    return;
                }

                if (name === 'prompt') {
                    systemPromptCache = allValues[0][0] || "";
                } else {
                    const [header, ...rows] = allValues;
                    newCache.set(name, mapRowsToObjects(header, rows));
                }
            } catch (err) {
                console.error(`Error fetching sheet "${name}":`, err);
                if (name === 'prompt') systemPromptCache = "";
            }
        }));

        sheetCache = newCache;
        if (systemPromptCache === null) systemPromptCache = "";
        
        resolveReady();
    } catch (err) {
        console.error("Error in fetchAllSheets:", err);
        resolveReady(); // Ensure we don't block forever
    }
}

/**
 * Returns the spreadsheet data cache, excluding private sheets.
 */
export function getAllSheetData(): Map<string, SheetData[]> {
    const publicCache = new Map<string, SheetData[]>();
    for (const [name, data] of sheetCache.entries()) {
        if (!name.toLowerCase().startsWith('private_')) {
            publicCache.set(name, data);
        }
    }
    return publicCache;
}

/**
 * Returns all cached data including private sheets (internal use only).
 */
export function getInternalSheetData(): Map<string, SheetData[]> {
    return sheetCache;
}

export function getSystemPrompt(): string {
    return systemPromptCache || "";
}
