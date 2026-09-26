import { describe, it, expect } from 'vitest';
import { TokenBucketLimiter } from './rateLimiter';

describe('TokenBucketLimiter', () => {
    function makeClock(start = 0) {
        let current = start;
        return {
            now: () => current,
            advance: (ms: number) => {
                current += ms;
            },
        };
    }

    it('should allow up to the capacity in a burst, then reject', () => {
        const clock = makeClock();
        const limiter = new TokenBucketLimiter({
            capacity: 3,
            refillPerSecond: 1,
            now: clock.now,
        });

        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);
    });

    it('should refill over time', () => {
        const clock = makeClock();
        const limiter = new TokenBucketLimiter({
            capacity: 2,
            refillPerSecond: 1,
            now: clock.now,
        });

        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);

        clock.advance(1000);
        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);
    });

    it('should never refill beyond the capacity', () => {
        const clock = makeClock();
        const limiter = new TokenBucketLimiter({
            capacity: 2,
            refillPerSecond: 1,
            now: clock.now,
        });

        limiter.tryConsume('a');
        limiter.tryConsume('a');
        clock.advance(60_000);

        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);
    });

    it('should track keys independently', () => {
        const clock = makeClock();
        const limiter = new TokenBucketLimiter({
            capacity: 1,
            refillPerSecond: 1,
            now: clock.now,
        });

        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);
        expect(limiter.tryConsume('b')).toBe(true);
    });

    it('should reset a key on release', () => {
        const clock = makeClock();
        const limiter = new TokenBucketLimiter({
            capacity: 1,
            refillPerSecond: 1,
            now: clock.now,
        });

        expect(limiter.tryConsume('a')).toBe(true);
        expect(limiter.tryConsume('a')).toBe(false);

        limiter.release('a');
        expect(limiter.tryConsume('a')).toBe(true);
    });

    it('should prune only fully refilled buckets', () => {
        const clock = makeClock();
        const limiter = new TokenBucketLimiter({
            capacity: 2,
            refillPerSecond: 1,
            now: clock.now,
        });

        limiter.tryConsume('stale');
        limiter.tryConsume('stale');
        limiter.tryConsume('fresh');
        limiter.tryConsume('fresh');

        // 1 秒では満タンに戻らないので、どちらも残る
        clock.advance(1000);
        limiter.prune();
        expect(limiter.tryConsume('stale')).toBe(true);

        // 十分な時間が経てば回収され、新しいバケットとして満タンから始まる
        clock.advance(60_000);
        limiter.prune();
        expect(limiter.tryConsume('fresh')).toBe(true);
        expect(limiter.tryConsume('fresh')).toBe(true);
        expect(limiter.tryConsume('fresh')).toBe(false);
    });
});
