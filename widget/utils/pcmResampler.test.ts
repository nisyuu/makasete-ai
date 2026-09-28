import { describe, it, expect } from 'vitest';
import { createPcmResampler } from './pcmResampler';

// 継ぎ目の確認に使う、なめらかな波形（440Hz の正弦波）
function sine(length: number, rate: number): Float32Array {
    return Float32Array.from({ length }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate));
}

function concat(parts: Float32Array[]): Float32Array {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

// 入力を断片に分けて順に変換した結果をつなげる
function processInChunks(input: Float32Array, sizes: number[], inRate: number, outRate: number): Float32Array {
    const resampler = createPcmResampler();
    const parts: Float32Array[] = [];
    let offset = 0;
    for (const size of sizes) {
        parts.push(resampler.process(input.subarray(offset, offset + size), inRate, outRate));
        offset += size;
    }
    return concat(parts);
}

describe('createPcmResampler', () => {
    it('should return the input as is when the rates match', () => {
        const input = Float32Array.from([0.1, 0.2, 0.3]);
        expect(createPcmResampler().process(input, 24000, 24000)).toBe(input);
    });

    it.each([48000, 44100])('should resample chunked input exactly as one continuous signal (24000 -> %i)', (outRate) => {
        // 断片ごとに独立して変換すると継ぎ目で波形が途切れ、iOS Safari でプツプツという雑音になる
        const input = sine(2400, 24000);
        const whole = createPcmResampler().process(input, 24000, outRate);
        const chunked = processInChunks(input, [960, 1920 - 960, 7, 2400 - 1927], 24000, outRate);

        expect(chunked.length).toBe(whole.length);
        for (let i = 0; i < whole.length; i++) {
            expect(chunked[i]).toBeCloseTo(whole[i], 6);
        }
    });

    it('should produce about outRate / inRate times as many samples', () => {
        const out = processInChunks(sine(2400, 24000), [960, 960, 480], 24000, 48000);
        // 最後の1サンプルは次の断片との補間用に持ち越すので、出力は1つ少ない
        expect(out.length).toBe(4798);
    });

    it('should interpolate linearly between samples', () => {
        const out = createPcmResampler().process(Float32Array.from([0, 1, 0]), 24000, 48000);
        expect([...out]).toEqual([0, 0.5, 1, 0.5]);
    });

    it('should not carry samples over after reset', () => {
        const resampler = createPcmResampler();
        resampler.process(Float32Array.from([1, 1, 1]), 24000, 48000);
        resampler.reset();
        const out = resampler.process(Float32Array.from([0, 0]), 24000, 48000);
        // 前の応答の最後のサンプル（1）が混ざらない
        expect([...out]).toEqual([0, 0]);
    });

    it('should start over when the sample rate changes', () => {
        const resampler = createPcmResampler();
        resampler.process(Float32Array.from([1, 1, 1]), 24000, 48000);
        const out = resampler.process(Float32Array.from([0, 0]), 16000, 48000);
        expect(out[0]).toBe(0);
    });
});
