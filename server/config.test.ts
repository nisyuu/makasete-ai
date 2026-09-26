import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveIntEnv } from './config';

describe('resolveIntEnv', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should use the fallback when unset or blank', () => {
        expect(resolveIntEnv('X', undefined, 1, 1, 10)).toBe(1);
        expect(resolveIntEnv('X', '', 1, 1, 10)).toBe(1);
        expect(resolveIntEnv('X', '   ', 1, 1, 10)).toBe(1);
    });

    it('should accept a value inside the range', () => {
        expect(resolveIntEnv('X', '2', 1, 1, 10)).toBe(2);
        expect(resolveIntEnv('X', '10', 1, 1, 10)).toBe(10);
    });

    it('should warn and fall back for values outside the range', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveIntEnv('TRUSTED_PROXY_COUNT', '0', 1, 1, 10)).toBe(1);
        expect(resolveIntEnv('TRUSTED_PROXY_COUNT', '99', 1, 1, 10)).toBe(1);
        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain('TRUSTED_PROXY_COUNT');
    });

    it('should warn and fall back for non-integers', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveIntEnv('X', 'abc', 5, 1, 10)).toBe(5);
        expect(resolveIntEnv('X', '1.5', 5, 1, 10)).toBe(5);
        expect(warnSpy).toHaveBeenCalledTimes(2);
    });
});
