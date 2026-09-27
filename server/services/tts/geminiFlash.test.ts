import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateContentStream, getGenerativeModel } = vi.hoisted(() => {
    const generateContentStream = vi.fn();
    return {
        generateContentStream,
        getGenerativeModel: vi.fn(() => ({ generateContentStream })),
    };
});

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(function () {
        return { getGenerativeModel };
    }),
}));

import { GeminiFlashTTSService } from './geminiFlash';
import { config } from '../../config';

// SDK の generateContentStream が返す、inlineData を持つ断片のストリームを組み立てる
function makeResult(parts: { inlineData?: { mimeType: string; data: string }; text?: string }[][]) {
    return {
        stream: (async function* () {
            for (const chunkParts of parts) {
                yield { candidates: [{ content: { parts: chunkParts } }] };
            }
        })(),
    };
}

const pcm = (bytes: number[]) => ({
    inlineData: { mimeType: 'audio/l16; rate=24000; channels=1', data: Buffer.from(bytes).toString('base64') },
});

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer[]> {
    const out: Buffer[] = [];
    for await (const c of stream) out.push(c as Buffer);
    return out;
}

describe('GeminiFlashTTSService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        config.geminiApiKey = 'test-key';
    });

    it('should report its name and PCM sample rate', () => {
        const svc = new GeminiFlashTTSService();
        expect(svc.getName()).toBe('gemini-flash-tts');
        expect(svc.pcmSampleRate).toBe(24000);
    });

    it('should request audio from the Flash Lite TTS model with the Aoede voice', async () => {
        generateContentStream.mockResolvedValue(makeResult([]));

        await collect(await new GeminiFlashTTSService().generateSpeechStream('こんにちは。'));

        expect(getGenerativeModel).toHaveBeenCalledWith({
            model: 'gemini-3.8-flash-lite-tts',
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
            },
        });
        expect(generateContentStream).toHaveBeenCalledWith('こんにちは。');
    });

    it('should yield each audio part as a decoded buffer in order, skipping non-audio parts', async () => {
        generateContentStream.mockResolvedValue(
            makeResult([[pcm([1, 2])], [{ text: 'ignored' }, pcm([3, 4, 5, 6])]]),
        );

        const chunks = await collect(await new GeminiFlashTTSService().generateSpeechStream('やあ。'));

        expect(chunks.map((c) => [...c])).toEqual([[1, 2], [3, 4, 5, 6]]);
    });

    it('should reuse the model across calls', async () => {
        generateContentStream.mockImplementation(() => Promise.resolve(makeResult([])));
        const svc = new GeminiFlashTTSService();

        await collect(await svc.generateSpeechStream('一。'));
        await collect(await svc.generateSpeechStream('二。'));

        expect(getGenerativeModel).toHaveBeenCalledTimes(1);
    });

    it('should throw when the API key is missing', async () => {
        config.geminiApiKey = '';
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(new GeminiFlashTTSService().generateSpeechStream('やあ。')).rejects.toThrow(
            'GEMINI_API_KEY is missing',
        );
        expect(generateContentStream).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it('should log and rethrow API errors', async () => {
        generateContentStream.mockRejectedValue(new Error('quota exceeded'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(new GeminiFlashTTSService().generateSpeechStream('やあ。')).rejects.toThrow('quota exceeded');
        expect(errSpy).toHaveBeenCalledWith('Gemini Flash TTS API Error:', 'quota exceeded');
        errSpy.mockRestore();
    });
});
