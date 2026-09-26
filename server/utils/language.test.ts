import { describe, it, expect } from 'vitest';
import { DEFAULT_LANGUAGE, resolveLanguage } from './language';

describe('resolveLanguage', () => {
    it('should pass through supported languages', () => {
        expect(resolveLanguage('ja')).toBe('ja');
        expect(resolveLanguage('en')).toBe('en');
    });

    it('should fall back for unknown languages', () => {
        expect(resolveLanguage('fr')).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage('')).toBe(DEFAULT_LANGUAGE);
    });

    it('should fall back for prototype keys', () => {
        // プレーンオブジェクトの辞書を直接引くと Object 由来の値が返り、
        // `??` のフォールバックをすり抜ける。入口で弾く。
        expect(resolveLanguage('constructor')).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage('toString')).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage('__proto__')).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage('hasOwnProperty')).toBe(DEFAULT_LANGUAGE);
    });

    it('should fall back for non-string values', () => {
        expect(resolveLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage(null)).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage(42)).toBe(DEFAULT_LANGUAGE);
        expect(resolveLanguage({})).toBe(DEFAULT_LANGUAGE);
    });
});
