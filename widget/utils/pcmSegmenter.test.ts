import { describe, it, expect } from 'vitest';
import { findCutPoint } from './pcmSegmenter';

describe('findCutPoint', () => {
    it('should cut in the middle of the last quiet window', () => {
        // 0-9: 音あり, 10-19: 無音, 20-29: 音あり
        const samples = Float32Array.from({ length: 30 }, (_, i) => (i >= 10 && i < 20 ? 0 : 0.5));
        expect(findCutPoint(samples, 0, 10, 0.02)).toBe(15);
    });

    it('should prefer the latest quiet window', () => {
        const samples = Float32Array.from({ length: 40 }, (_, i) =>
            (i >= 0 && i < 10) || (i >= 20 && i < 30) ? 0 : 0.5,
        );
        expect(findCutPoint(samples, 0, 10, 0.02)).toBe(25);
    });

    it('should fall back to the quietest window when nothing is silent', () => {
        const samples = Float32Array.from({ length: 30 }, (_, i) => (i >= 10 && i < 20 ? 0.1 : 0.5));
        expect(findCutPoint(samples, 0, 10, 0.02)).toBe(15);
    });

    it('should not cut before from', () => {
        const samples = Float32Array.from({ length: 30 }, (_, i) => (i < 10 ? 0 : 0.5));
        // 無音は 0-9 にしかないが from=10 なので、それより後のいちばん静かな所で切る
        expect(findCutPoint(samples, 10, 10, 0.02)).toBeGreaterThanOrEqual(10);
    });

    it('should return the end when no window fits after from', () => {
        const samples = new Float32Array(15);
        expect(findCutPoint(samples, 10, 10, 0.02)).toBe(15);
    });
});
