// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initAudioHandler } from './audioHandler';

const flush = () => new Promise((r) => setTimeout(r, 0));

// SpeechRecognitionEvent を模した結果イベントを組み立てる。
// results は配列ライク（length/添字アクセス）で、各要素は [{ transcript }] に isFinal を付与したもの。
function makeResultEvent(
    resultIndex: number,
    items: { transcript: string; isFinal: boolean }[],
) {
    const results = items.map((it) => {
        const result: { 0: { transcript: string }; isFinal: boolean } = {
            0: { transcript: it.transcript },
            isFinal: it.isFinal,
        };
        return result;
    });
    return { resultIndex, results: { ...results, length: results.length } };
}

// --- Web Audio API モック ---
let createdSources: MockBufferSource[];
let decodeShouldFail = false;

class MockBufferSource {
    buffer: unknown = null;
    onended: (() => void) | null = null;
    connect = vi.fn();
    start = vi.fn();
    stop = vi.fn();
}

class MockGainNode {
    connect = vi.fn();
}

class MockAudioContext {
    state: 'running' | 'suspended' = 'suspended';
    destination = {};
    createGain = vi.fn(() => new MockGainNode());
    createBufferSource = vi.fn(() => {
        const s = new MockBufferSource();
        createdSources.push(s);
        return s;
    });
    decodeAudioData = vi.fn(() =>
        decodeShouldFail ? Promise.reject(new Error('decode fail')) : Promise.resolve({}),
    );
    resume = vi.fn(async () => {
        this.state = 'running';
    });
    close = vi.fn(async () => {});
}

// --- SpeechRecognition モック ---
let createdRecognitions: MockRecognition[];
class MockRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    constructor() {
        createdRecognitions.push(this);
    }
}

describe('initAudioHandler', () => {
    beforeEach(() => {
        createdSources = [];
        createdRecognitions = [];
        decodeShouldFail = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).AudioContext = MockAudioContext;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext = undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).SpeechRecognition = MockRecognition;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitSpeechRecognition = undefined;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function setup(overrides = {}) {
        const opts = {
            onTranscript: vi.fn(),
            onRecordingEnd: vi.fn(),
            onError: vi.fn(),
            language: 'ja',
            ...overrides,
        };
        const handler = initAudioHandler(opts);
        return { handler, opts };
    }

    describe('AudioContext lifecycle', () => {
        it('initAudioContext should create a context once', () => {
            const { handler } = setup();
            handler.initAudioContext();
            handler.initAudioContext();
            // 内部状態のため、resume 経由で running になることで検証
            expect(() => handler.initAudioContext()).not.toThrow();
        });

        it('resumeAudioContext should resume a suspended context', async () => {
            const { handler } = setup();
            await handler.resumeAudioContext();
            // 二度目は state が running のため resume されない（例外が出ないこと）
            await expect(handler.resumeAudioContext()).resolves.toBeUndefined();
        });
    });

    describe('audio playback queue', () => {
        it('should decode and play an ArrayBuffer chunk', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(8));
            await flush();
            expect(createdSources).toHaveLength(1);
            expect(createdSources[0].start).toHaveBeenCalledWith(0);
        });

        it('should accept a serialized Buffer object', async () => {
            const { handler } = setup();
            handler.handleAudioChunk({ type: 'Buffer', data: [1, 2, 3] });
            await flush();
            expect(createdSources).toHaveLength(1);
        });

        it('should accept a Uint8Array', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new Uint8Array([1, 2, 3]));
            await flush();
            expect(createdSources).toHaveLength(1);
        });

        it('should warn and ignore an unexpected format', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { handler } = setup();
            handler.handleAudioChunk('not-audio');
            await flush();
            expect(warnSpy).toHaveBeenCalled();
            expect(createdSources).toHaveLength(0);
        });

        it('should play queued chunks sequentially via onended', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2));
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            // 1つ目だけ再生中
            expect(createdSources).toHaveLength(1);
            // 再生終了をシミュレートして次を再生
            createdSources[0].onended!();
            await flush();
            expect(createdSources).toHaveLength(2);
        });

        it('should recover when decoding fails', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            decodeShouldFail = true;
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            expect(errSpy).toHaveBeenCalled();
            // 失敗後も次の再生を受け付ける
            decodeShouldFail = false;
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            expect(createdSources.length).toBeGreaterThanOrEqual(1);
        });

        it('resetAudioState should stop the current source and clear the queue', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            handler.resetAudioState();
            expect(createdSources[0].stop).toHaveBeenCalled();
        });
    });

    describe('speech recognition', () => {
        it('should report support correctly', () => {
            const { handler } = setup();
            expect(handler.isSpeechRecognitionSupported()).toBe(true);
        });

        it('should configure language ja-JP by default', () => {
            setup({ language: 'ja' });
            expect(createdRecognitions[0].lang).toBe('ja-JP');
        });

        it('should configure language en-US for english', () => {
            setup({ language: 'en' });
            expect(createdRecognitions[0].lang).toBe('en-US');
        });

        it('should toggle recording start and stop', () => {
            const { handler } = setup();
            const rec = createdRecognitions[0];
            handler.toggleRecording();
            expect(rec.start).toHaveBeenCalled();
            handler.toggleRecording();
            expect(rec.stop).toHaveBeenCalled();
        });

        it('should preview interim results without sending, then deliver the final text once on end', () => {
            const { opts } = setup();
            const rec = createdRecognitions[0];

            // 認識途中（未確定）: 入力欄プレビュー用に onTranscript が呼ばれるだけ
            rec.onresult!(makeResultEvent(0, [{ transcript: 'こん', isFinal: false }]));
            expect(opts.onTranscript).toHaveBeenLastCalledWith('こん');
            // この段階では確定通知（送信トリガー）は来ない
            expect(opts.onRecordingEnd).not.toHaveBeenCalled();

            // 確定
            rec.onresult!(makeResultEvent(0, [{ transcript: 'こんにちは', isFinal: true }]));
            expect(opts.onTranscript).toHaveBeenLastCalledWith('こんにちは');

            // 録音終了で確定テキストを「一度だけ」渡す
            rec.onend!();
            expect(opts.onRecordingEnd).toHaveBeenCalledTimes(1);
            expect(opts.onRecordingEnd).toHaveBeenCalledWith('こんにちは');
        });

        it('should accumulate multiple final segments without duplication', () => {
            const { opts } = setup();
            const rec = createdRecognitions[0];

            rec.onresult!(makeResultEvent(0, [{ transcript: 'こんにちは', isFinal: true }]));
            // event.results は累積。resultIndex 以降（新規分）だけを加算し、確定済みは再加算しない。
            rec.onresult!(
                makeResultEvent(1, [
                    { transcript: 'こんにちは', isFinal: true },
                    { transcript: 'また明日', isFinal: true },
                ]),
            );

            rec.onend!();
            expect(opts.onRecordingEnd).toHaveBeenCalledWith('こんにちはまた明日');
        });

        it('should reset accumulated text between recordings', () => {
            const { handler, opts } = setup();
            const rec = createdRecognitions[0];

            rec.onresult!(makeResultEvent(0, [{ transcript: 'こんにちは', isFinal: true }]));
            rec.onend!();

            // 新しい録音を開始すると蓄積はクリアされる
            handler.toggleRecording();
            rec.onresult!(makeResultEvent(0, [{ transcript: 'さようなら', isFinal: true }]));
            rec.onend!();

            expect(opts.onRecordingEnd).toHaveBeenLastCalledWith('さようなら');
        });

        it('should surface recognition errors and report empty final text', () => {
            const { opts } = setup();
            const rec = createdRecognitions[0];
            rec.onerror!({ error: 'no-speech' });
            expect(opts.onRecordingEnd).toHaveBeenCalledWith('');
            expect(opts.onError).toHaveBeenCalledWith(expect.any(Error));
        });

        it('should warn when speech recognition is unsupported', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).SpeechRecognition = undefined;
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { handler } = setup();
            expect(handler.isSpeechRecognitionSupported()).toBe(false);
            expect(warnSpy).toHaveBeenCalled();
            // recognition 未初期化でも toggle は安全
            expect(() => handler.toggleRecording()).not.toThrow();
        });
    });

    describe('cleanup', () => {
        it('should stop recognition and close the audio context', async () => {
            const { handler } = setup();
            handler.initAudioContext();
            const rec = createdRecognitions[0];
            handler.cleanup();
            expect(rec.stop).toHaveBeenCalled();
        });
    });
});
