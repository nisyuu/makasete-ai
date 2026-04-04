import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapRowsToObjects, getAllSheetData, getInternalSheetData, fetchAllSheets } from './sheets';
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
            (sheets.spreadsheets.get as any).mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { title: 'faq' } },
                        { properties: { title: 'private_knowledge' } },
                    ]
                }
            });

            // Mock fetching sheet values
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
    });
});
