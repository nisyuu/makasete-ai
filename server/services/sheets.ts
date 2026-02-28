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
    const keyName = 'tasukari-4170ed37d5cd.json';
    const absoluteKeyPath = path.join(process.cwd(), keyName);

    const scopes = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
    const keyFile = fs.existsSync(absoluteKeyPath) ? absoluteKeyPath : undefined;

    if (keyFile) {
        console.log("Using local key file for Sheets Auth");
    } else {
        console.log("Using ADC for Sheets Auth");
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
    } catch (err) {
        console.error("Error fetching products:", err);
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
    } catch (err) {
        console.error("Error fetching news:", err);
        return [];
    }
}

export function getProducts(): Product[] {
    return productCache;
}

export function getNews(): News[] {
    return newsCache;
}
