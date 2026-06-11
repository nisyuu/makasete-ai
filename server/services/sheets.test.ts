import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapRowsToObjects, getAllSheetData, getInternalSheetData, fetchAllSheets, getSystemPrompt } from './sheets';
import { google } from 'googleapis';
import { config } from '../config';

// 1. Correctly mock googleapis
vi.mock('googleapis', () => {
    const mockSpreadsheets = {
        get: vi.fn(),
        values: {
            get: vi.fn(),
        },
    };
    return {
        google: {
            auth: {
                // Use a proper function for the constructor
                GoogleAuth: vi.fn().mockImplementation(function() {
                    return {
                        getCredentials: vi.fn(),
                    };
                }),
            },
            sheets: vi.fn().mockReturnValue({
                spreadsheets: mockSpreadsheets,
            }),
        },
    };
});

describe('sheets service utilities', () => {
    describe('mapRowsToObjects', () => {
        it('should map rows to objects using header as keys', () => {
            const header = ['ID', 'Name', 'Price'];
            const rows = [['1', 'Apple', '100'], ['2', 'Banana', '200']];
            const result = mapRowsToObjects(header, rows);
            
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ id: '1', name: 'Apple', price: '100' });
            expect(result[1]).toEqual({ id: '2', name: 'Banana', price: '200' });
        });

        it('should convert header keys to snake_case', () => {
            const header = ['Product Name', 'DiscountPrice', 'User-Count', 'Already_Snake'];
            const rows = [['Apple', '80', '10', 'Yes']];
            const result = mapRowsToObjects(header, rows);
            
            expect(result[0]).toEqual({
                product_name: 'Apple',
                discount_price: '80',
                user_count: '10',
                already_snake: 'Yes'
            });
        });

        it('should handle empty cells', () => {
            const header = ['ID', 'Name'];
            const rows = [['1', '']];
            const result = mapRowsToObjects(header, rows);
            expect(result[0].name).toBe('');
        });

        it('should skip empty header keys', () => {
            const header = ['ID', '', 'Name'];
            const rows = [['1', 'Secret', 'Apple']];
            const result = mapRowsToObjects(header, rows);
            expect(result[0]).toEqual({ id: '1', name: 'Apple' });
            expect(Object.keys(result[0])).not.toContain('');
        });
    });

    describe('Sheet Filtering (Private vs Public)', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            config.googleSheetsId = 'test-id';
        });

        it('should filter out private_ sheets in getAllSheetData but keep in getInternalSheetData', async () => {
            const sheets = google.sheets({ version: 'v4' });
            
            // Mock listing sheets
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.get as any).mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { title: 'faq' } },
                        { properties: { title: 'private_knowledge' } },
                    ]
                }
            });

            // Mock fetching sheet values
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.values.get as any).mockImplementation(({ range }: { range: string }) => {
                return Promise.resolve({
                    data: {
                        values: [['ID', 'Value'], ['1', `Data from ${range}`]]
                    }
                });
            });

            // Execute fetch
            await fetchAllSheets();

            const publicData = getAllSheetData();
            const internalData = getInternalSheetData();

            // Public check: 'faq' should be there, 'private_knowledge' should be hidden
            expect(publicData.has('faq')).toBe(true);
            expect(publicData.has('private_knowledge')).toBe(false);

            // Internal check: both should be there
            expect(internalData.has('faq')).toBe(true);
            expect(internalData.has('private_knowledge')).toBe(true);
        });

        it('should skip sheets whose name starts with "wip" and capture the prompt sheet', async () => {
            const sheets = google.sheets({ version: 'v4' });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.get as any).mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { title: 'faq' } },
                        { properties: { title: 'wip_draft' } },
                        { properties: { title: 'prompt' } },
                        { properties: { title: null } },
                    ],
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.values.get as any).mockImplementation(({ range }: { range: string }) => {
                if (range.startsWith('prompt')) {
                    return Promise.resolve({ data: { values: [['You are a bot']] } });
                }
                return Promise.resolve({ data: { values: [['ID'], ['1']] } });
            });

            await fetchAllSheets();

            const data = getAllSheetData();
            expect(data.has('faq')).toBe(true);
            expect(data.has('wip_draft')).toBe(false);
            // prompt is stored separately, not as sheet data
            expect(data.has('prompt')).toBe(false);
            expect(getSystemPrompt()).toBe('You are a bot');
        });

        it('should treat empty sheets and an empty prompt gracefully', async () => {
            const sheets = google.sheets({ version: 'v4' });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.get as any).mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { title: 'empty_sheet' } },
                        { properties: { title: 'prompt' } },
                    ],
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.values.get as any).mockResolvedValue({ data: { values: [] } });

            await fetchAllSheets();

            expect(getAllSheetData().get('empty_sheet')).toEqual([]);
            expect(getSystemPrompt()).toBe('');
        });

        it('should keep working when an individual sheet fetch fails', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const sheets = google.sheets({ version: 'v4' });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.get as any).mockResolvedValue({
                data: { sheets: [{ properties: { title: 'broken' } }] },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.values.get as any).mockRejectedValue(new Error('range error'));

            await expect(fetchAllSheets()).resolves.toBeUndefined();
            errSpy.mockRestore();
        });

        it('should return early and warn when GOOGLE_SHEETS_ID is not set', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            config.googleSheetsId = undefined;

            await fetchAllSheets();

            expect(warnSpy).toHaveBeenCalledWith('GOOGLE_SHEETS_ID is not set.');
            warnSpy.mockRestore();
        });

        it('should not throw when the spreadsheet metadata request fails', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            config.googleSheetsId = 'test-id';
            const sheets = google.sheets({ version: 'v4' });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (sheets.spreadsheets.get as any).mockRejectedValue(new Error('auth failed'));

            await expect(fetchAllSheets()).resolves.toBeUndefined();
            expect(errSpy).toHaveBeenCalled();
            errSpy.mockRestore();
        });
    });
});
