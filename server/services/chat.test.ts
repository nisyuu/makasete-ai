import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

const { getAllSheetData, generateResponseStream, generateSpeechStream, getTTSService } = vi.hoisted(() => {
    const generateSpeechStream = vi.fn();
    return {
        getAllSheetData: vi.fn(),
        generateResponseStream: vi.fn(),
        generateSpeechStream,
        getTTSService: vi.fn(() => ({ generateSpeechStream, getName: () => 'mock' })),
    };
});

vi.mock('./sheets', () => ({ getAllSheetData }));
vi.mock('./gemini', () => ({ generateResponseStream }));
vi.mock('./tts/factory', () => ({ getTTSService }));

import { ChatService } from './chat';

// 与えられたテキストチャンク列を chunk.text() を持つストリームに変換する
function makeStream(chunks: string[]) {
    return (async function* () {
        for (const text of chunks) {
            yield { text: () => text };
        }
    })();
}

interface FakeSocket {
    emit: ReturnType<typeof vi.fn>;
}

function makeSocket(): FakeSocket {
    return { emit: vi.fn() };
}

describe('ChatService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAllSheetData.mockReturnValue(new Map());
        // 各呼び出しで新しいストリームを返す（消費済みストリームの再利用を防ぐ）
        generateSpeechStream.mockImplementation(() => Promise.resolve(Readable.from([Buffer.from('A')])));
    });

    describe('input validation', () => {
        it('should emit an error for empty text', async () => {
            const socket = makeSocket();
            const svc = new ChatService();
            await svc.handleUserInput(socket as never, { text: '', isVoiceInput: false });
            expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Input is invalid' });
            expect(generateResponseStream).not.toHaveBeenCalled();
        });

        it('should emit an error for text longer than 1000 chars', async () => {
            const socket = makeSocket();
            const svc = new ChatService();
            await svc.handleUserInput(socket as never, { text: 'a'.repeat(1001), isVoiceInput: false });
            expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Input is invalid' });
        });

        it('should emit an error for non-string text', async () => {
            const socket = makeSocket();
            const svc = new ChatService();
            await svc.handleUserInput(socket as never, { text: 123 as unknown as string, isVoiceInput: false });
            expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Input is invalid' });
        });
    });

    describe('text mode (non-voice)', () => {
        it('should emit text chunks per sentence and a completion event', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['こんにちは。', 'お元気で']));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: false });

            const textChunks = socket.emit.mock.calls.filter((c) => c[0] === 'text-chunk');
            expect(textChunks).toEqual([
                ['text-chunk', { content: 'こんにちは。' }],
                ['text-chunk', { content: 'お元気で' }],
            ]);
            expect(socket.emit).toHaveBeenCalledWith('response-complete');
        });

        it('should strip tags from the UI text', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['<b>太字</b>です。']));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: false });
            expect(socket.emit).toHaveBeenCalledWith('text-chunk', { content: '太字です。' });
        });

        it('should default language to ja and pass it to the generator', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['x。']));
            const socket = makeSocket();
            const svc = new ChatService();
            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: false });
            expect(generateResponseStream).toHaveBeenCalledWith('hi', expect.any(Map), expect.any(Array), 'ja');
        });
    });

    describe('voice mode', () => {
        it('should emit text and audio chunks for a plain sentence', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['やあ。']));
            generateSpeechStream.mockResolvedValue(Readable.from([Buffer.from('AUDIO')]));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });

            expect(socket.emit).toHaveBeenCalledWith('audio-chunk', { type: 'text', content: 'やあ。' });
            const audioEmit = socket.emit.mock.calls.find(
                (c) => c[0] === 'audio-chunk' && c[1].type === 'audio',
            );
            expect(audioEmit).toBeTruthy();
            expect(Buffer.isBuffer(audioEmit![1].content)).toBe(true);
            expect((audioEmit![1].content as Buffer).toString()).toBe('AUDIO');
        });

        it('should wrap SSML-tagged sentences in <speak> for TTS', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['<speak>こんにちは</speak>。']));
            generateSpeechStream.mockResolvedValue(Readable.from([Buffer.from('A')]));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });

            const ttsArg = generateSpeechStream.mock.calls[0][0];
            expect(ttsArg.startsWith('<speak>')).toBe(true);
            expect(ttsArg.endsWith('</speak>')).toBe(true);
        });

        it('should skip TTS when the tagged input has no spoken content', async () => {
            // 句読点を含まないので flush 経由で processSentence に渡る
            generateResponseStream.mockResolvedValue(makeStream(['<speak></speak>']));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });
            expect(generateSpeechStream).not.toHaveBeenCalled();
        });

        it('should not crash when the TTS stream errors', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['やあ。']));
            const errStream = new Readable({ read() {} });
            generateSpeechStream.mockResolvedValue(errStream);
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const socket = makeSocket();
            const svc = new ChatService();

            const promise = svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });
            // 次のtickでエラーを発火させる
            setTimeout(() => errStream.emit('error', new Error('tts fail')), 0);
            await promise;

            expect(socket.emit).toHaveBeenCalledWith('response-complete');
            errSpy.mockRestore();
        });
    });

    describe('history management', () => {
        it('should trim history when it grows beyond 20 entries', async () => {
            const socket = makeSocket();
            const svc = new ChatService();
            generateSpeechStream.mockResolvedValue(Readable.from([Buffer.from('A')]));

            for (let i = 0; i < 12; i++) {
                generateResponseStream.mockResolvedValueOnce(makeStream([`返答${i}。`]));
                await svc.handleUserInput(socket as never, { text: `msg${i}`, isVoiceInput: false });
            }
            // 履歴が無制限に増えないことを確認（最後の呼び出しの履歴長 <= 20）
            const lastHistory = generateResponseStream.mock.calls.at(-1)![2];
            expect(lastHistory.length).toBeLessThanOrEqual(20);
        });
    });

    describe('error handling', () => {
        it('should emit an internal error when the generator throws', async () => {
            generateResponseStream.mockRejectedValue(new Error('gemini down'));
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: false });

            expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Internal server error occurred.' });
            errSpy.mockRestore();
        });
    });
});
