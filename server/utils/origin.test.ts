import { describe, it, expect, vi } from 'vitest';
import {
    ALLOW_ALL_ORIGINS,
    isOriginAllowed,
    isOwnOrigin,
    parseAllowedOrigins,
    resolveAllowedOrigins,
} from './origin';
import { encodeList } from './encodedList';

describe('resolveAllowedOrigins', () => {
    it('should use ALLOWED_ORIGINS when the encoded value is absent', () => {
        expect(resolveAllowedOrigins({ ALLOWED_ORIGINS: 'https://a.example' })).toEqual(['https://a.example']);
        expect(resolveAllowedOrigins({})).toBe(ALLOW_ALL_ORIGINS);
        expect(resolveAllowedOrigins({ ALLOWED_ORIGINS_B64: '' })).toBe(ALLOW_ALL_ORIGINS);
    });

    it('should prefer ALLOWED_ORIGINS_B64 and normalize its entries', () => {
        expect(
            resolveAllowedOrigins({
                ALLOWED_ORIGINS: '*',
                ALLOWED_ORIGINS_B64: encodeList(['https://Shop.Example/', 'https://b.example']),
            }),
        ).toEqual(['https://shop.example', 'https://b.example']);
    });

    it('should treat an encoded empty list as unregistered (allow all)', () => {
        expect(resolveAllowedOrigins({ ALLOWED_ORIGINS_B64: encodeList([]) })).toBe(ALLOW_ALL_ORIGINS);
    });

    it('should drop the wildcard and invalid entries from the encoded list', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(
            resolveAllowedOrigins({ ALLOWED_ORIGINS_B64: encodeList(['*', 'not a url', 'https://ok.example']) }),
        ).toEqual(['https://ok.example']);
        warnSpy.mockRestore();
    });

    it('should reject every origin when the encoded value is malformed', () => {
        // 壊れた設定で全許可に戻ると、気付かないまま公開状態になる
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(resolveAllowedOrigins({ ALLOWED_ORIGINS_B64: 'bad;value' })).toEqual([]);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

describe('isOwnOrigin', () => {
    it('should match when the Origin host equals the Host header', () => {
        expect(isOwnOrigin('https://svc.a.run.app', 'svc.a.run.app')).toBe(true);
        expect(isOwnOrigin('https://SVC.a.run.app', 'svc.a.run.app:443')).toBe(true);
        expect(isOwnOrigin('http://localhost:8080', 'localhost:8080')).toBe(true);
    });

    it('should not match a different site or port', () => {
        expect(isOwnOrigin('https://evil.example', 'svc.a.run.app')).toBe(false);
        expect(isOwnOrigin('http://localhost:3000', 'localhost:8080')).toBe(false);
    });

    it('should not match when either header is missing or unparsable', () => {
        expect(isOwnOrigin(undefined, 'svc.a.run.app')).toBe(false);
        expect(isOwnOrigin('https://svc.a.run.app', undefined)).toBe(false);
        expect(isOwnOrigin('null', 'svc.a.run.app')).toBe(false);
    });
});

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

    it('should normalize trailing slashes, paths and case', () => {
        // 設定の書き方の揺れでウィジェットが動かなくなるのを防ぐ
        expect(parseAllowedOrigins('https://Shop.Example/')).toEqual(['https://shop.example']);
        expect(parseAllowedOrigins('https://shop.example/path')).toEqual(['https://shop.example']);
        expect(parseAllowedOrigins('https://shop.example:443/')).toEqual(['https://shop.example']);
    });

    it('should drop duplicates that differ only in spelling', () => {
        expect(parseAllowedOrigins('https://shop.example,https://shop.example/')).toEqual([
            'https://shop.example',
        ]);
    });

    it('should drop invalid entries without falling back to allowing everything', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // 設定ミスで全許可に戻ってしまうと、気付かないまま公開状態になる
        expect(parseAllowedOrigins('not a url')).toEqual([]);
        expect(parseAllowedOrigins('https://ok.example,not a url')).toEqual(['https://ok.example']);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
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

    it('should accept an Origin header that differs only in spelling', () => {
        expect(isOriginAllowed('https://SHOP.example', allowed)).toBe(true);
        expect(isOriginAllowed('https://shop.example:443', allowed)).toBe(true);
    });

    it('should reject an unparsable or opaque Origin', () => {
        // sandbox iframe や file:// からの接続は Origin が "null" になる
        expect(isOriginAllowed('null', allowed)).toBe(false);
        expect(isOriginAllowed('garbage', allowed)).toBe(false);
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
