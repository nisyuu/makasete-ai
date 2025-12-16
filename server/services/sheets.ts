import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { config } from '../config';

export interface Product {
    id: string;
    title: string;
    author: string;
    price: string;
    category: string;
    image_url: string;
    description: string;
    amazon_link: string;
    amazon_kindle_link: string;
    published_at: string;
}

export interface News {
    id: string;
    title: string;
    content: string;
    published_at: string;
}

let productCache: Product[] = [];
let newsCache: News[] = [];

export async function fetchProducts(): Promise<Product[]> {
    if (!config.googleSheetsId) {
        console.warn("GOOGLE_SHEETS_ID is not set. Returning empty product list.");
        return [];
    }

    try {
        // Setup Google Sheets API
        // Authentication strategy:
        // 1. If key.json is present (for local dev), set keyFilename.
        // 2. If missing (Cloud Run), use ADC (empty config).

        const keyName = 'tasukari-4170ed37d5cd.json';
        const absoluteKeyPath = path.join(process.cwd(), keyName);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authConfig: any = {
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        };

        if (fs.existsSync(absoluteKeyPath)) {
            console.log("Using local key file for Sheets Auth");
            authConfig.keyFilename = absoluteKeyPath;
        } else {
            console.log("Using ADC for Sheets Auth");
        }

        const auth = new google.auth.GoogleAuth(authConfig);

        const client = await auth.getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sheets = google.sheets({ version: 'v4', auth: client as any });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.googleSheetsId,
            range: 'books!A2:J', // Exclude header row (A1)
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('No data found in sheets.');
            return [];
        }

        // Mapping columns safely
        productCache = rows.map((row) => ({
            id: row[0] || '',
            title: row[1] || '',
            author: row[2] || '',
            price: row[3] || '',
            category: row[4] || '',
            image_url: row[5] || '',
            description: row[6] || '',
            amazon_link: row[7] || '',
            amazon_kindle_link: row[8] || '',
            published_at: row[9] || '',
        }));

        console.log(`Loaded ${productCache.length} products to cache.`);
        return productCache;
    } catch (err) {
        console.error("Error fetching sheets:", err);
        // Fallback or empty
        return [];
    }
}

export async function fetchNews(): Promise<News[]> {
    if (!config.googleSheetsId) {
        console.warn("GOOGLE_SHEETS_ID is not set. Returning empty news list.");
        return [];
    }

    try {
        const keyName = 'tasukari-4170ed37d5cd.json';
        const absoluteKeyPath = path.join(process.cwd(), keyName);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authConfig: any = {
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        };

        if (fs.existsSync(absoluteKeyPath)) {
            authConfig.keyFilename = absoluteKeyPath;
        }

        const auth = new google.auth.GoogleAuth(authConfig);

        const client = await auth.getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sheets = google.sheets({ version: 'v4', auth: client as any });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: config.googleSheetsId,
            range: 'news!A2:D', // Exclude header
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            console.log('No news data found.');
            return [];
        }

        newsCache = rows.map((row) => ({
            id: row[0] || '',
            title: row[1] || '',
            content: row[2] || '',
            published_at: row[3] || '',
        }));

        console.log(`Loaded ${newsCache.length} news items to cache.`);
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
