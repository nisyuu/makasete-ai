import { describe, it, expect } from 'vitest';
import {
    DEFAULT_PUBLIC_SHEETS,
    PUBLIC_ALL_SHEETS,
    isSheetPublic,
    parsePublicSheets,
} from './publicSheets';

describe('parsePublicSheets', () => {
    it('should fall back to the default list when unset', () => {
        expect(parsePublicSheets(undefined)).toEqual([...DEFAULT_PUBLIC_SHEETS]);
    });

    it('should parse a comma-separated list and trim entries', () => {
        expect(parsePublicSheets('settings, faqs ,items')).toEqual(['settings', 'faqs', 'items']);
    });

    it('should treat an empty value as exposing nothing', () => {
        // 明示的に空を指定したら、公開しない意図として扱う
        expect(parsePublicSheets('')).toEqual([]);
    });

    it('should return the wildcard when "*" is present', () => {
        expect(parsePublicSheets('settings,*')).toBe(PUBLIC_ALL_SHEETS);
    });
});

describe('isSheetPublic', () => {
    const allowed = ['settings', 'items'];

    it('should allow listed sheets', () => {
        expect(isSheetPublic('settings', allowed)).toBe(true);
        expect(isSheetPublic('items', allowed)).toBe(true);
    });

    it('should reject sheets that are not listed', () => {
        // 接頭辞を付け忘れた社内向けシートが公開されるのを防ぐ
        expect(isSheetPublic('internal_memo', allowed)).toBe(false);
        expect(isSheetPublic('faqs', allowed)).toBe(false);
    });

    it('should never expose the prompt sheet', () => {
        expect(isSheetPublic('prompt', allowed)).toBe(false);
        expect(isSheetPublic('prompt', PUBLIC_ALL_SHEETS)).toBe(false);
        expect(isSheetPublic('prompt', ['prompt'])).toBe(false);
    });

    it('should never expose private_ sheets even when listed or with the wildcard', () => {
        expect(isSheetPublic('private_settings', PUBLIC_ALL_SHEETS)).toBe(false);
        expect(isSheetPublic('private_settings', ['private_settings'])).toBe(false);
        expect(isSheetPublic('PRIVATE_notes', PUBLIC_ALL_SHEETS)).toBe(false);
    });

    it('should expose everything else under the wildcard', () => {
        expect(isSheetPublic('anything', PUBLIC_ALL_SHEETS)).toBe(true);
    });
});
