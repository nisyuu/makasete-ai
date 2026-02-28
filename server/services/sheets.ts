import fs from 'fs';
import path from 'path';
import { google, sheets_v4 } from 'googleapis';
import { config } from '../config';

export interface Product {
    id: string;
    title: string;
    [key: string]: string;
}

export interface News {
    id: string;
    title: string;
    [key: string]: string;
}

let productCache: Product[] = [];
let newsCache: News[] = [];
let systemPromptCache: string = "";

/**
 * Maps spreadsheet rows to objects using the first row as keys.
 * Converts column names to snake_case for consistency.
 */
function mapRowsToObjects<T>(header: string[], rows: string[][]): T[] {
    return rows.map((row) => {
        const obj: Record<string, string> = {};
        header.forEach((key, index) => {
            if (!key) return;
            // Convert "Column Name" or "columnName" to "column_name"
            const safeKey = key
                .trim()
                .replace(/([a-z])([A-Z])/g, '$1_$2')
                .toLowerCase()
                .replace(/\s+/g, '_');
            obj[safeKey] = row[index] || '';
        });
        return obj as T;
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
        // Basic check to see if the file is readable and not empty
        try {
            const stats = fs.statSync(absoluteKeyPath);
            if (stats.size > 0) {
                keyFile = absoluteKeyPath;
                console.log(`Using local key file ${localKeyName} for Sheets Auth`);
            } else {
                console.warn(`Local key file ${localKeyName} is empty.`);
            }
        } catch (e) {
            console.warn(`Could not read local key file ${localKeyName}:`, e);
        }
    }

    if (!keyFile && !process.env.K_SERVICE) { // Not on Cloud Run and no key file
        console.warn("No valid authentication found (GOOGLE_APPLICATION_CREDENTIALS or google-key.json). Local Sheets API calls will likely fail.");
    } else if (!keyFile) {
        console.log("Using Default ADC for Sheets Auth (assuming Cloud Run environment)");
    }

    const auth = new google.auth.GoogleAuth({
        scopes,
        keyFile,
    });

    return google.sheets({ version: 'v4', auth });
}

export async function fetchProducts(): Promise<Product[]> {
    if (!config.googleSheetsId) {
        console.warn("GOOGLE_SHEETS_ID is not set. Returning empty product list.");
        return [];
    }

    try {
        const sheets = await getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.googleSheetsId,
            range: 'books!A1:Z', // Fetch including header row
        });

        const allValues = response.data.values;
        if (!allValues || allValues.length < 1) {
            console.log('No data found in books sheet.');
            return [];
        }

        const [header, ...rows] = allValues;
        productCache = mapRowsToObjects<Product>(header, rows);

        console.log(`Loaded ${productCache.length} products to cache with columns: ${header.join(', ')}`);
        return productCache;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Error fetching products:", message);
        return [];
    }
}

export async function fetchNews(): Promise<News[]> {
    if (!config.googleSheetsId) {
        console.warn("GOOGLE_SHEETS_ID is not set. Returning empty news list.");
        return [];
    }

    try {
        const sheets = await getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.googleSheetsId,
            range: 'news!A1:Z',
        });

        const allValues = response.data.values;
        if (!allValues || allValues.length < 1) {
            console.log('No news data found.');
            return [];
        }

        const [header, ...rows] = allValues;
        newsCache = mapRowsToObjects<News>(header, rows);

        console.log(`Loaded ${newsCache.length} news items to cache with columns: ${header.join(', ')}`);
        return newsCache;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Error fetching news:", message);
        return [];
    }
}

export async function fetchSystemPrompt(): Promise<string> {
    if (!config.googleSheetsId) {
        console.warn("GOOGLE_SHEETS_ID is not set. Returning empty prompt.");
        return "";
    }

    try {
        const sheets = await getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.googleSheetsId,
            range: 'prompt!A1:A1',
        });

        const values = response.data.values;
        if (!values || values.length === 0 || !values[0][0]) {
            console.log('No prompt found in prompt sheet.');
            return "";
        }

        systemPromptCache = values[0][0];
        console.log("Loaded system prompt from sheet.");
        return systemPromptCache;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Error fetching system prompt:", message);
        return "";
    }
}

export function getProducts(): Product[] {
    return productCache;
}

export function getNews(): News[] {
    return newsCache;
}

export function getSystemPrompt(): string {
    return systemPromptCache;
}
