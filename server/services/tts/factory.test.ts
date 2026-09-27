import { describe, it, expect, beforeEach, vi } from 'vitest';

const { ElevenLabsCtor, GeminiCtor, GeminiFlashCtor } = vi.hoisted(() => ({
    ElevenLabsCtor: vi.fn().mockImplementation(function () {
        return { getName: () => 'elevenlabs' };
    }),
    GeminiCtor: vi.fn().mockImplementation(function () {
        return { getName: () => 'gemini-tts' };
    }),
    GeminiFlashCtor: vi.fn().mockImplementation(function () {
        return { getName: () => 'gemini-flash-tts' };
    }),
}));

vi.mock('./elevenlabs', () => ({ ElevenLabsTTSService: ElevenLabsCtor }));
vi.mock('./google', () => ({ GeminiTTSService: GeminiCtor }));
vi.mock('./geminiFlash', () => ({ GeminiFlashTTSService: GeminiFlashCtor }));

// resetModules を使うため、config も factory も毎回フレッシュにインポートして
// 同一レジストリ上の config インスタンスを共有させる。
async function loadFactory(provider: 'gemini' | 'gemini-flash-tts' | 'elevenlabs') {
    vi.resetModules();
    const { config } = await import('../../config');
    config.ttsProvider = provider;
    const { getTTSService } = await import('./factory');
    return getTTSService;
}

describe('getTTSService factory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return the Cloud TTS (Chirp 3: HD) service for "gemini"', async () => {
        const getTTSService = await loadFactory('gemini');
        expect(getTTSService().getName()).toBe('gemini-tts');
        expect(GeminiCtor).toHaveBeenCalledTimes(1);
    });

    it('should return the Gemini Flash TTS service for "gemini-flash-tts"', async () => {
        const getTTSService = await loadFactory('gemini-flash-tts');
        expect(getTTSService().getName()).toBe('gemini-flash-tts');
        expect(GeminiFlashCtor).toHaveBeenCalledTimes(1);
        expect(GeminiCtor).not.toHaveBeenCalled();
    });

    it('should return the ElevenLabs service when configured', async () => {
        const getTTSService = await loadFactory('elevenlabs');
        expect(getTTSService().getName()).toBe('elevenlabs');
        expect(ElevenLabsCtor).toHaveBeenCalledTimes(1);
    });

    it('should cache the service instance across calls', async () => {
        const getTTSService = await loadFactory('gemini');
        const first = getTTSService();
        const second = getTTSService();
        expect(first).toBe(second);
        expect(GeminiCtor).toHaveBeenCalledTimes(1);
    });
});
