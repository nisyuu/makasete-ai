import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

const { synthesize, GoogleAuth, texttospeech } = vi.hoisted(() => {
    const synthesize = vi.fn();
    return {
        synthesize,
        GoogleAuth: vi.fn().mockImplementation(function () {
            return {};
        }),
        texttospeech: vi.fn(() => ({ text: { synthesize } })),
    };
});

vi.mock('googleapis', () => ({
    google: {
        auth: { GoogleAuth },
        texttospeech,
    },
}));

import { GeminiTTSService } from './google';

describe('GeminiTTSService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        delete process.env.K_SERVICE;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        delete process.env.K_SERVICE;
    });

    // 認証情報の解決分岐（env var / ローカルキー / Cloud Run）を検証する。
    const okAudio = (_req: unknown, cb: (e: unknown, r: unknown) => void) =>
        cb(null, { data: { audioContent: Buffer.from('x').toString('base64') } });

    it('should expose its name', () => {
        expect(new GeminiTTSService().getName()).toBe('gemini-tts');
    });

    it('should use GOOGLE_APPLICATION_CREDENTIALS when the env var is set', async () => {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/secrets/creds.json';
        synthesize.mockImplementation(okAudio);

        await new GeminiTTSService().generateSpeechStream('hi');

        expect(GoogleAuth).toHaveBeenCalledWith(
            expect.objectContaining({ keyFile: '/secrets/creds.json' }),
        );
    });

    it('should fall back to a local key file when present', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        synthesize.mockImplementation(okAudio);

        await new GeminiTTSService().generateSpeechStream('hi');

        expect(GoogleAuth).toHaveBeenCalledWith(
            expect.objectContaining({ keyFile: expect.stringContaining('google-key.json') }),
        );
    });

    it('should not warn on Cloud Run (K_SERVICE set) when no credentials are found', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        process.env.K_SERVICE = 'makasete-service';
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        synthesize.mockImplementation(okAudio);

        await new GeminiTTSService().generateSpeechStream('hi');

        expect(warnSpy).not.toHaveBeenCalled();
        expect(GoogleAuth).toHaveBeenCalledWith(
            expect.objectContaining({ keyFile: undefined }),
        );
    });

    it('should synthesize plain text and return a readable stream of decoded audio', async () => {
        const audio = Buffer.from('hello-audio').toString('base64');
        synthesize.mockImplementation((_req, cb) => cb(null, { data: { audioContent: audio } }));

        const svc = new GeminiTTSService();
        const stream = await svc.generateSpeechStream('こんにちは', 'ja');

        const reqBody = synthesize.mock.calls[0][0].requestBody;
        expect(reqBody.input).toEqual({ text: 'こんにちは' });
        expect(reqBody.voice).toEqual({ languageCode: 'ja-JP', name: 'ja-JP-Chirp3-HD-Aoede' });
        expect(reqBody.audioConfig).toEqual({ audioEncoding: 'MP3', speakingRate: 1.15 });

        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        expect(Buffer.concat(chunks).toString()).toBe('hello-audio');
    });

    it('should detect SSML input and use the ssml field', async () => {
        const audio = Buffer.from('x').toString('base64');
        synthesize.mockImplementation((_req, cb) => cb(null, { data: { audioContent: audio } }));

        const svc = new GeminiTTSService();
        await svc.generateSpeechStream('<speak>hi</speak>', 'en');

        const reqBody = synthesize.mock.calls[0][0].requestBody;
        expect(reqBody.input).toEqual({ ssml: '<speak>hi</speak>' });
        expect(reqBody.voice).toEqual({ languageCode: 'en-US', name: 'en-US-Chirp3-HD-Aoede' });
    });

    it('should fall back to the Japanese voice for unknown languages', async () => {
        const audio = Buffer.from('x').toString('base64');
        synthesize.mockImplementation((_req, cb) => cb(null, { data: { audioContent: audio } }));

        const svc = new GeminiTTSService();
        await svc.generateSpeechStream('bonjour', 'fr');

        const reqBody = synthesize.mock.calls[0][0].requestBody;
        expect(reqBody.voice.languageCode).toBe('ja-JP');
    });

    it('should throw when no audio content is returned', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        synthesize.mockImplementation((_req, cb) => cb(null, { data: {} }));

        const svc = new GeminiTTSService();
        await expect(svc.generateSpeechStream('hi')).rejects.toThrow('No audio content received from Google TTS');
        errSpy.mockRestore();
    });

    it('should rethrow and log when synthesis errors', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        synthesize.mockImplementation((_req, cb) => cb(new Error('quota exceeded')));

        const svc = new GeminiTTSService();
        await expect(svc.generateSpeechStream('hi')).rejects.toThrow('quota exceeded');
        expect(errSpy).toHaveBeenCalledWith('Gemini TTS API Error:', 'quota exceeded');
        errSpy.mockRestore();
    });

    it('should cache the client across calls', async () => {
        const audio = Buffer.from('x').toString('base64');
        synthesize.mockImplementation((_req, cb) => cb(null, { data: { audioContent: audio } }));

        const svc = new GeminiTTSService();
        await svc.generateSpeechStream('a');
        await svc.generateSpeechStream('b');
        expect(texttospeech).toHaveBeenCalledTimes(1);
    });
});
