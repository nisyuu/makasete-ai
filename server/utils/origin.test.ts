import { describe, it, expect } from 'vitest';
import { ALLOW_ALL_ORIGINS, isOriginAllowed, parseAllowedOrigins } from './origin';

describe('parseAllowedOrigins', () => {
    it('should return the wildcard when unset or empty', () => {
        expect(parseAllowedOrigins(undefined)).toBe(ALLOW_ALL_ORIGINS);
        expect(parseAllowedOrigins('')).toBe(ALLOW_ALL_ORIGINS);
        expect(parseAllowedOrigins('  ,  ')).toBe(ALLOW_ALL_ORIGINS);
    });

    it('should return the wildcard when the list contains "*"', () => {
        expect(parseAllowedOrigins('https://a.example,*')).toBe(ALLOW_ALL_ORIGINS);
    });

    it('should parse a single origin', () => {
        expect(parseAllowedOrigins('https://a.example')).toEqual(['https://a.example']);
    });

    it('should trim whitespace around comma-separated origins', () => {
        expect(parseAllowedOrigins('https://a.example, https://b.example')).toEqual([
            'https://a.example',
            'https://b.example',
        ]);
    });

    it('should drop empty entries from trailing commas', () => {
        expect(parseAllowedOrigins('https://a.example,,')).toEqual(['https://a.example']);
    });
});

describe('isOriginAllowed', () => {
    const allowed = ['https://shop.example', 'https://www.shop.example'];

    it('should allow any origin when the wildcard is configured', () => {
        expect(isOriginAllowed('https://evil.example', ALLOW_ALL_ORIGINS)).toBe(true);
    });

    it('should allow listed origins', () => {
        expect(isOriginAllowed('https://shop.example', allowed)).toBe(true);
        expect(isOriginAllowed('https://www.shop.example', allowed)).toBe(true);
    });

    it('should reject unlisted origins', () => {
        expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    });

    it('should reject a subdomain that is not explicitly listed', () => {
        expect(isOriginAllowed('https://evil.shop.example', allowed)).toBe(false);
    });

    it('should distinguish scheme and port', () => {
        expect(isOriginAllowed('http://shop.example', allowed)).toBe(false);
        expect(isOriginAllowed('https://shop.example:8443', allowed)).toBe(false);
    });

    it('should allow requests without an Origin header', () => {
        // Origin を送らないのは同一 origin の fetch やサーバー間通信であり、
        // ブラウザ経由の第三者埋め込みは必ず Origin を送る。
        expect(isOriginAllowed(undefined, allowed)).toBe(true);
    });
});
