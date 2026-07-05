import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

const { getAllSheetData, generateResponseStream, generateSpeechStream, getTTSService } = vi.hoisted(() => {
    const generateSpeechStream = vi.fn();
    return {
        getAllSheetData: vi.fn(),
        generateResponseStream: vi.fn(),
        generateSpeechStream,
        getTTSService: vi.fn(() => ({ generateSpeechStream, getName: (): string => 'mock' })),
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

        it('should start TTS concurrently for multiple sentences', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['こんにちは。', '元気ですか？']));
            // beforeEach provides mockImplementation that creates a fresh stream per call
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });

            // TTS called once per sentence
            expect(generateSpeechStream).toHaveBeenCalledTimes(2);
            // Audio emitted in order for both sentences
            const audioEmits = socket.emit.mock.calls.filter(
                (c) => c[0] === 'audio-chunk' && c[1].type === 'audio',
            );
            expect(audioEmits).toHaveLength(2);
        });

        it('should emit a multi-chunk TTS stream as a single concatenated audio chunk', async () => {
            // MP3 must not be split at arbitrary byte boundaries, so a sentence
            // whose TTS stream arrives in several parts must be emitted as one
            // complete MP3 rather than one audio-chunk per stream part.
            generateResponseStream.mockResolvedValue(makeStream(['やあ。']));
            generateSpeechStream.mockResolvedValue(
                Readable.from([Buffer.from('AU'), Buffer.from('DI'), Buffer.from('O')]),
            );
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });

            const audioEmits = socket.emit.mock.calls.filter(
                (c) => c[0] === 'audio-chunk' && c[1].type === 'audio',
            );
            // 断片ごとではなく1文=1チャンクで送信される
            expect(audioEmits).toHaveLength(1);
            expect((audioEmits[0][1].content as Buffer).toString()).toBe('AUDIO');
        });

        it('should not emit an audio chunk for an empty TTS stream', async () => {
            generateResponseStream.mockResolvedValue(makeStream(['やあ。']));
            generateSpeechStream.mockResolvedValue(Readable.from([]));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });

            const audioEmits = socket.emit.mock.calls.filter(
                (c) => c[0] === 'audio-chunk' && c[1].type === 'audio',
            );
            expect(audioEmits).toHaveLength(0);
        });

        it('should apply SSML pause breaks for Google TTS', async () => {
            getTTSService.mockReturnValueOnce({ generateSpeechStream, getName: () => 'gemini-tts' });
            generateResponseStream.mockResolvedValue(makeStream(['やあ。']));
            generateSpeechStream.mockResolvedValue(Readable.from([Buffer.from('A')]));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: 'hi', isVoiceInput: true });

            const ttsArg = generateSpeechStream.mock.calls[0][0];
            expect(ttsArg).toContain('<speak>');
            expect(ttsArg).toContain('<break time="300ms"/>');
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

    describe('recommendations', () => {
        const productSheet = new Map([
            ['products', [
                { name: 'ブレンドコーヒー', description: '深煎り豆の香り高い一杯', tags: 'コーヒー' },
                { name: '抹茶ラテ', description: '宇治抹茶を使ったラテ', tags: '抹茶' },
            ]],
        ]);

        it('should emit only the products the AI actually mentioned in its answer', async () => {
            getAllSheetData.mockReturnValue(productSheet);
            generateResponseStream.mockResolvedValue(makeStream(['おすすめはブレンドコーヒーです。']));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: '何かおすすめはありますか', isVoiceInput: false });

            const rec = socket.emit.mock.calls.find((c) => c[0] === 'recommendation');
            expect(rec).toBeTruthy();
            expect(rec![1].products.map((p: { name: string }) => p.name)).toEqual(['ブレンドコーヒー']);
        });

        it('should not emit recommendations for an unrelated question', async () => {
            getAllSheetData.mockReturnValue(productSheet);
            generateResponseStream.mockResolvedValue(makeStream(['営業時間は10時から18時です。']));
            const socket = makeSocket();
            const svc = new ChatService();

            await svc.handleUserInput(socket as never, { text: '営業時間を教えてください', isVoiceInput: false });

            const rec = socket.emit.mock.calls.find((c) => c[0] === 'recommendation');
            expect(rec).toBeUndefined();
        });
    });

    describe('cancellation (barge-in)', () => {
        const tick = () => new Promise((r) => setTimeout(r, 0));

        it('supersedes an in-flight response when a newer input arrives', async () => {
            const socket = makeSocket();
            const svc = new ChatService();

            let releaseFirst!: () => void;
            const firstGate = new Promise<void>((r) => {
                releaseFirst = r;
            });

            generateResponseStream.mockReset();
            generateResponseStream
                .mockImplementationOnce(async () =>
                    (async function* () {
                        yield { text: () => '最初の文。' };
                        await firstGate; // 2つ目の入力が割り込むまで停止
                        yield { text: () => '割り込み後の文。' };
                    })(),
                )
                .mockImplementationOnce(async () => makeStream(['新しい応答。']));

            const p1 = svc.handleUserInput(socket as never, { text: 'first', isVoiceInput: false });
            await tick(); // 1つ目が最初の文を処理して停止するまで待つ
            const p2 = svc.handleUserInput(socket as never, { text: 'second', isVoiceInput: false });
            releaseFirst();
            await Promise.all([p1, p2]);

            // 割り込まれた1つ目は完了イベントを出さず、2つ目のみ完了する
            const completes = socket.emit.mock.calls.filter((c) => c[0] === 'response-complete');
            expect(completes).toHaveLength(1);
            // 割り込み後のチャンクは送信されない
            const staleChunk = socket.emit.mock.calls.find(
                (c) => c[0] === 'text-chunk' && c[1].content === '割り込み後の文。',
            );
            expect(staleChunk).toBeUndefined();
            // 新しい応答は送信される
            expect(socket.emit).toHaveBeenCalledWith('text-chunk', { content: '新しい応答。' });
        });

        it('does not emit stale text or audio for a superseded voice response', async () => {
            const socket = makeSocket();
            const svc = new ChatService();

            let releaseFirst!: () => void;
            const firstGate = new Promise<void>((r) => {
                releaseFirst = r;
            });

            generateResponseStream.mockReset();
            generateResponseStream
                .mockImplementationOnce(async () =>
                    (async function* () {
                        yield { text: () => '最初の音声。' };
                        await firstGate; // 2つ目の入力が割り込むまで停止
                        yield { text: () => '割り込み後の音声。' };
                    })(),
                )
                .mockImplementationOnce(async () => makeStream(['新しい音声。']));

            const p1 = svc.handleUserInput(socket as never, { text: 'first', isVoiceInput: true });
            await tick();
            const p2 = svc.handleUserInput(socket as never, { text: 'second', isVoiceInput: true });
            releaseFirst();
            await Promise.all([p1, p2]);

            // 割り込み後の文はテキスト（audio-chunk type:text）として送信されない
            const staleText = socket.emit.mock.calls.find(
                (c) =>
                    c[0] === 'audio-chunk' &&
                    c[1].type === 'text' &&
                    c[1].content === '割り込み後の音声。',
            );
            expect(staleText).toBeUndefined();
            // 完了は新しい応答の1回のみ
            const completes = socket.emit.mock.calls.filter((c) => c[0] === 'response-complete');
            expect(completes).toHaveLength(1);
            // 新しい応答は送信される
            expect(socket.emit).toHaveBeenCalledWith('audio-chunk', { type: 'text', content: '新しい音声。' });
        });

        it('does not emit an error for a response that was already superseded', async () => {
            const socket = makeSocket();
            const svc = new ChatService();

            let releaseFirst!: () => void;
            const firstGate = new Promise<void>((r) => {
                releaseFirst = r;
            });

            generateResponseStream.mockReset();
            generateResponseStream
                .mockImplementationOnce(async () =>
                    (async function* () {
                        yield { text: () => '途中。' };
                        await firstGate;
                        throw new Error('late failure'); // 割り込み後に失敗する
                    })(),
                )
                .mockImplementationOnce(async () => makeStream(['新しい応答。']));

            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const p1 = svc.handleUserInput(socket as never, { text: 'first', isVoiceInput: false });
            await tick();
            const p2 = svc.handleUserInput(socket as never, { text: 'second', isVoiceInput: false });
            releaseFirst();
            await Promise.all([p1, p2]);
            errSpy.mockRestore();

            // 割り込まれた応答が失敗しても、ユーザーにはエラーを通知しない
            const errors = socket.emit.mock.calls.filter((c) => c[0] === 'error');
            expect(errors).toHaveLength(0);
            // 新しい応答は正常に完了する
            expect(socket.emit).toHaveBeenCalledWith('response-complete');
        });

        it('drops the superseded response from chat history', async () => {
            const socket = makeSocket();
            const svc = new ChatService();

            let releaseFirst!: () => void;
            const firstGate = new Promise<void>((r) => {
                releaseFirst = r;
            });

            generateResponseStream.mockReset();
            generateResponseStream
                .mockImplementationOnce(async () =>
                    (async function* () {
                        yield { text: () => '古い応答。' };
                        await firstGate;
                    })(),
                )
                .mockImplementationOnce(async () => makeStream(['新しい応答。']))
                .mockImplementationOnce(async () => makeStream(['3回目。']));

            const p1 = svc.handleUserInput(socket as never, { text: 'first', isVoiceInput: false });
            await tick();
            const p2 = svc.handleUserInput(socket as never, { text: 'second', isVoiceInput: false });
            releaseFirst();
            await Promise.all([p1, p2]);

            // 3回目の入力に渡る履歴を検査する
            await svc.handleUserInput(socket as never, { text: 'third', isVoiceInput: false });
            const history = generateResponseStream.mock.calls.at(-1)![2] as {
                role: string;
                parts: { text: string }[];
            }[];
            const modelTexts = history.filter((h) => h.role === 'model').map((h) => h.parts[0].text);
            // 割り込まれた「古い応答。」はモデル履歴に残らない
            expect(modelTexts).toContain('新しい応答。');
            expect(modelTexts).not.toContain('古い応答。');
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
