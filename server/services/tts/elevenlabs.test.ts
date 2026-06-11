import { describe, it, expect, beforeEach, vi } from 'vitest';

const { convert, ElevenLabsClient } = vi.hoisted(() => {
    const convert = vi.fn();
    return {
        convert,
        ElevenLabsClient: vi.fn().mockImplementation(function () {
            return { textToSpeech: { convert } };
        }),
    };
});

vi.mock('@elevenlabs/elevenlabs-js', () => ({ ElevenLabsClient }));

import { ElevenLabsTTSService } from './elevenlabs';
import { config } from '../../config';

describe('ElevenLabsTTSService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        config.elevenLabsApiKey = 'test-key';
    });

    it('should expose its name', () => {
        expect(new ElevenLabsTTSService().getName()).toBe('elevenlabs');
    });

    it('should throw when the API key is missing', async () => {
        config.elevenLabsApiKey = '';
        const svc = new ElevenLabsTTSService();
        await expect(svc.generateSpeechStream('hello')).rejects.toThrow('ELEVENLABS_API_KEY is missing');
    });

    it('should call the ElevenLabs client and return a readable stream', async () => {
        convert.mockResolvedValue((async function* () {
            yield Buffer.from('chunk1');
            yield Buffer.from('chunk2');
        })());

        const svc = new ElevenLabsTTSService();
        const stream = await svc.generateSpeechStream('hello world');

        expect(ElevenLabsClient).toHaveBeenCalledWith({ apiKey: 'test-key' });
        expect(convert).toHaveBeenCalledWith(
            config.voiceId,
            expect.objectContaining({ text: 'hello world', modelId: config.modelId }),
        );

        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(c as Buffer);
        expect(Buffer.concat(chunks).toString()).toBe('chunk1chunk2');
    });

    it('should rethrow and log when the client fails', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        convert.mockRejectedValue(new Error('api down'));
        const svc = new ElevenLabsTTSService();

        await expect(svc.generateSpeechStream('hi')).rejects.toThrow('api down');
        expect(errSpy).toHaveBeenCalledWith('ElevenLabs API Error:', 'api down');
        errSpy.mockRestore();
    });
});
