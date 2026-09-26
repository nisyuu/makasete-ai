import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from './concurrencyLimiter';

describe('ConcurrencyLimiter', () => {
    it('should allow up to the limit', () => {
        const limiter = new ConcurrencyLimiter(2);
        expect(limiter.tryAcquire()).toBeTypeOf('function');
        expect(limiter.tryAcquire()).toBeTypeOf('function');
        expect(limiter.tryAcquire()).toBeNull();
    });

    it('should free a slot on release', () => {
        const limiter = new ConcurrencyLimiter(1);
        const release = limiter.tryAcquire()!;
        expect(limiter.tryAcquire()).toBeNull();

        release();
        expect(limiter.activeCount()).toBe(0);
        expect(limiter.tryAcquire()).toBeTypeOf('function');
    });

    it('should ignore a repeated release', () => {
        // finally と catch の両方から呼ばれても枠を増やしてはいけない
        const limiter = new ConcurrencyLimiter(2);
        const release = limiter.tryAcquire()!;
        limiter.tryAcquire();

        release();
        release();
        release();
        expect(limiter.activeCount()).toBe(1);
    });

    it('should cap the number of generations regardless of how many clients ask', () => {
        // IP の識別に失敗しても、同時に走る本数はここで頭打ちになる
        const limiter = new ConcurrencyLimiter(3);
        const releases = [];
        for (let i = 0; i < 10; i++) {
            const release = limiter.tryAcquire();
            if (release) releases.push(release);
        }
        expect(releases).toHaveLength(3);
        expect(limiter.activeCount()).toBe(3);
    });
});
