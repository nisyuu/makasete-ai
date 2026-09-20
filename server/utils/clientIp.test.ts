import { describe, it, expect } from 'vitest';
import { resolveClientIp } from './clientIp';

describe('resolveClientIp', () => {
    const remote = '10.0.0.1';

    it('should fall back to the socket address when no header is present', () => {
        expect(resolveClientIp(undefined, remote)).toBe(remote);
        expect(resolveClientIp('', remote)).toBe(remote);
        expect(resolveClientIp('  ,  ', remote)).toBe(remote);
    });

    it('should use the single forwarded value', () => {
        expect(resolveClientIp('203.0.113.5', remote)).toBe('203.0.113.5');
    });

    it('should take the proxy-appended value, not the client-controlled left edge', () => {
        // クライアントが詐称した値が左端に残る。信頼できるのは Cloud Run が
        // 追記した右端の値。
        expect(resolveClientIp('1.2.3.4, 203.0.113.5', remote)).toBe('203.0.113.5');
    });

    it('should ignore a fully spoofed chain and use the real appended IP', () => {
        expect(
            resolveClientIp('9.9.9.9, 8.8.8.8, 203.0.113.5', remote),
        ).toBe('203.0.113.5');
    });

    it('should honour a larger trusted proxy count', () => {
        expect(
            resolveClientIp('1.2.3.4, 203.0.113.5, 198.51.100.7', remote, 2),
        ).toBe('203.0.113.5');
    });

    it('should clamp when there are fewer hops than trusted proxies', () => {
        expect(resolveClientIp('203.0.113.5', remote, 3)).toBe('203.0.113.5');
    });

    it('should join array headers before parsing', () => {
        expect(
            resolveClientIp(['1.2.3.4', '203.0.113.5'], remote),
        ).toBe('203.0.113.5');
    });

    it('should trim surrounding whitespace', () => {
        expect(resolveClientIp('1.2.3.4 ,  203.0.113.5  ', remote)).toBe('203.0.113.5');
    });
});
