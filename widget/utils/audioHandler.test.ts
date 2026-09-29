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

class MockAudioBuffer {
    readonly duration: number;
    private readonly channel: Float32Array;
    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number,
    ) {
        this.duration = length / sampleRate;
        this.channel = new Float32Array(length);
    }
    getChannelData(_i: number) {
        return this.channel;
    }
}

class MockAudioContext {
    state: 'running' | 'suspended' = 'suspended';
    currentTime = 0;
    sampleRate = 24000;
    destination = {};
    createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
        if (sampleRate < 3000) throw new Error('NotSupportedError');
        return new MockAudioBuffer(channels, length, sampleRate);
    });
    createGain = vi.fn(() => new MockGainNode());
    createBufferSource = vi.fn(() => {
        const s = new MockBufferSource();
        createdSources.push(s);
        return s;
    });
    decodeAudioData = vi.fn((_buffer: ArrayBuffer) =>
        decodeShouldFail ? Promise.reject(new Error('decode fail')) : Promise.resolve({}),
    );
    resume = vi.fn(async () => {
        this.state = 'running';
    });
    close = vi.fn(async () => {});
    constructor() {
        // テストから生成されたコンテキストの状態を操作できるようにする
        (window as unknown as { __lastCtx?: MockAudioContext }).__lastCtx = this;
    }
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

        it('should decode only the view when given a Uint8Array over a larger buffer', async () => {
            // 大きなバッファの一部を指すビューを .buffer のまま渡すと、前後の
            // 無関係なバイトまで decode してしまい失敗する。
            const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
            const view = backing.subarray(2, 5);
            const { handler } = setup();
            handler.initAudioContext();
            const ctx = (window as unknown as { __lastCtx?: MockAudioContext }).__lastCtx;

            handler.handleAudioChunk(view);
            await flush();

            const passed = ctx!.decodeAudioData.mock.calls[0][0] as ArrayBuffer;
            expect(passed.byteLength).toBe(3);
            expect(Array.from(new Uint8Array(passed))).toEqual([1, 2, 3]);
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

        it('should drop the rest of the response after resetAudioState until beginResponse', async () => {
            // 読み上げ OFF やウィンドウを閉じた後に、同じ応答の続きが鳴り出さないようにする
            const { handler } = setup();
            handler.resetAudioState();
            handler.handleAudioChunk(new ArrayBuffer(2));
            handler.handleAudioChunk(new Uint8Array([0, 0]), { sampleRate: 24000 });
            await flush();
            expect(createdSources).toHaveLength(0);

            handler.beginResponse();
            handler.handleAudioChunk(new Uint8Array([0, 0]), { sampleRate: 24000 });
            // 短い PCM は溜めてから鳴らすので、次の断片を待つ時間が過ぎてから予約される
            await new Promise((r) => setTimeout(r, 200));
            expect(createdSources).toHaveLength(1);
        });

        it('should not play a chunk whose decode finishes after a reset', async () => {
            // decode 待ちの間に新しいメッセージを送る（リセットされる）と、
            // 古い音声が decode 完了後に鳴って新しい音声と重なっていた。
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2)); // 古い応答（decode 中）
            handler.beginResponse(); // 新しいメッセージを送信
            await flush();
            expect(createdSources).toHaveLength(0);
        });

        it('should play the new response alone after a reset during decode', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2)); // 古い応答（decode 中）
            handler.beginResponse();
            handler.handleAudioChunk(new ArrayBuffer(4)); // 新しい応答
            await flush();
            await flush();
            // 鳴るのは新しい応答の 1 本だけで、同時に 2 本は鳴らない
            expect(createdSources).toHaveLength(1);
            expect(createdSources[0].start).toHaveBeenCalledTimes(1);
        });

        it('should keep the queue working after a stale decode is dropped', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2));
            handler.beginResponse();
            await flush();

            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            expect(createdSources).toHaveLength(1);

            // 1 本目の再生が終われば、次のチャンクも再生される
            handler.handleAudioChunk(new ArrayBuffer(2));
            createdSources[0].onended?.();
            await flush();
            expect(createdSources).toHaveLength(2);
        });
    });

    describe('PCM playback', () => {
        const ctx = () => (window as unknown as { __lastCtx: MockAudioContext }).__lastCtx;
        // 16bit リトルエンディアンの PCM を組み立てる
        const pcm = (samples: number[]) => {
            const view = new DataView(new ArrayBuffer(samples.length * 2));
            samples.forEach((v, i) => view.setInt16(i * 2, v, true));
            return view.buffer;
        };
        // 0.25 秒ごとに 30ms の無音を挟む、発話を模した波形（24kHz）
        const speech = (seconds: number) =>
            Array.from({ length: Math.round(seconds * 24000) }, (_, i) =>
                i % 6000 < 720 ? 0 : Math.round(16000 * Math.sin((2 * Math.PI * 220 * i) / 24000)),
            );
        // 波形を 40ms ずつの断片にして順に渡す（Gemini Flash TTS の断片の長さ）
        const feed = (handler: ReturnType<typeof setup>['handler'], samples: number[]) => {
            for (let i = 0; i < samples.length; i += 960) {
                handler.handleAudioChunk(pcm(samples.slice(i, i + 960)), { sampleRate: 24000 });
            }
        };
        const flushPcm = () => vi.advanceTimersByTime(200);
        const segments = () =>
            createdSources.map((s) => ({
                start: s.start.mock.calls[0][0] as number,
                buffer: s.buffer as MockAudioBuffer,
            }));

        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should convert 16-bit PCM to floats without decodeAudioData', () => {
            const { handler } = setup();
            handler.handleAudioChunk(pcm([0, 16384, -32768]), { sampleRate: 24000 });
            flushPcm();

            expect(ctx().decodeAudioData).not.toHaveBeenCalled();
            expect(ctx().createBuffer).toHaveBeenCalledWith(1, 3, 24000);
            const buffer = createdSources[0].buffer as MockAudioBuffer;
            expect([...buffer.getChannelData(0)]).toEqual([0, 0.5, -1]);
        });

        it('should group small chunks into a few segments', () => {
            // iOS Safari は短い AudioBuffer を並べると継ぎ目ごとにプツッと鳴るので、継ぎ目を減らす
            const { handler } = setup();
            feed(handler, speech(4)); // 40ms × 100 断片
            flushPcm();

            expect(createdSources.length).toBeGreaterThan(1);
            expect(createdSources.length).toBeLessThanOrEqual(8);
            const total = segments().reduce((n, s) => n + s.buffer.length, 0);
            expect(total).toBe(4 * 24000);
        });

        it('should place segments back to back without gaps', () => {
            const { handler } = setup();
            handler.initAudioContext();
            ctx().currentTime = 1;
            feed(handler, speech(4));
            flushPcm();

            const segs = segments();
            expect(segs[0].start).toBe(1);
            for (let i = 1; i < segs.length; i++) {
                expect(segs[i].start).toBeCloseTo(segs[i - 1].start + segs[i - 1].buffer.length / 24000, 9);
            }
        });

        it('should put seams in the pauses between phrases', () => {
            const { handler } = setup();
            feed(handler, speech(4));
            flushPcm();

            const segs = segments();
            for (let i = 0; i < segs.length - 1; i++) {
                const data = segs[i].buffer.getChannelData(0);
                const next = segs[i + 1].buffer.getChannelData(0);
                // 継ぎ目の前後 5ms が無音
                expect(Math.max(...data.subarray(data.length - 120).map(Math.abs))).toBe(0);
                expect(Math.max(...next.subarray(0, 120).map(Math.abs))).toBe(0);
            }
        });

        it('should start playing after a short first segment without waiting for the whole response', () => {
            const { handler } = setup();
            feed(handler, speech(0.4));

            // タイマーを進めなくても最初の区間は予約される
            expect(createdSources).toHaveLength(1);
            expect(createdSources[0].buffer).toBeInstanceOf(MockAudioBuffer);
            expect((createdSources[0].buffer as MockAudioBuffer).length).toBeLessThanOrEqual(0.4 * 24000);
        });

        it('should play what is left once the chunks stop arriving', () => {
            const { handler } = setup();
            handler.handleAudioChunk(pcm(new Array(2400).fill(0)), { sampleRate: 24000 }); // 0.1秒
            expect(createdSources).toHaveLength(0);

            flushPcm();
            expect(createdSources).toHaveLength(1);
        });

        it.each([48000, 44100])('should resample to the output rate (%i)', (outRate) => {
            // 出力のレートへの変換をブラウザに任せず、断片をつなげたまま変換する
            const { handler } = setup();
            handler.initAudioContext();
            ctx().sampleRate = outRate;
            ctx().currentTime = 1;
            feed(handler, speech(2));
            flushPcm();

            for (const call of ctx().createBuffer.mock.calls) {
                expect(call[2]).toBe(outRate);
            }
            const segs = segments();
            expect(Math.abs(segs[0].start * outRate - Math.round(segs[0].start * outRate))).toBeLessThan(1e-6);
            for (let i = 1; i < segs.length; i++) {
                expect(segs[i].start).toBeCloseTo(segs[i - 1].start + segs[i - 1].buffer.length / outRate, 9);
            }
            const total = segs.reduce((n, s) => n + s.buffer.length, 0);
            expect(Math.abs(total - 2 * outRate)).toBeLessThanOrEqual(2);
        });

        it('should start immediately when the previous segment has already finished', () => {
            const { handler } = setup();
            handler.initAudioContext();
            handler.handleAudioChunk(pcm(new Array(2400).fill(0)), { sampleRate: 24000 });
            flushPcm();
            // 前の区間が鳴り終わってから次が届いた
            ctx().currentTime = 5;
            handler.handleAudioChunk(pcm(new Array(2400).fill(0)), { sampleRate: 24000 });
            flushPcm();

            expect(createdSources[1].start).toHaveBeenCalledWith(5);
        });

        it('should drop a trailing odd byte and ignore empty chunks', () => {
            const { handler } = setup();
            handler.handleAudioChunk(new Uint8Array([0, 64, 9]), { sampleRate: 24000 });
            handler.handleAudioChunk(new Uint8Array([9]), { sampleRate: 24000 });
            flushPcm();

            expect(ctx().createBuffer).toHaveBeenCalledTimes(1);
            expect(ctx().createBuffer).toHaveBeenCalledWith(1, 1, 24000);
            expect(createdSources).toHaveLength(1);
        });

        it('should skip a chunk whose sample rate the browser rejects', () => {
            const { handler } = setup();
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            handler.handleAudioChunk(pcm([1]), { sampleRate: 1 });
            flushPcm();

            expect(createdSources).toHaveLength(0);
            expect(errSpy).toHaveBeenCalled();
        });

        it('should stop scheduled segments, drop pending audio and restart the timeline on reset', () => {
            const { handler } = setup();
            handler.initAudioContext();
            feed(handler, speech(0.5));
            const scheduled = createdSources.length;
            expect(scheduled).toBeGreaterThan(0);

            handler.beginResponse();
            for (const s of createdSources) expect(s.stop).toHaveBeenCalled();
            // 溜まっていた前の応答の残りは鳴らさない
            flushPcm();
            expect(createdSources).toHaveLength(scheduled);

            // リセット後の新しい応答は、古い予約の後ろではなく今から鳴らす
            ctx().currentTime = 0.05;
            handler.handleAudioChunk(pcm(new Array(2400).fill(0)), { sampleRate: 24000 });
            flushPcm();
            expect(createdSources[scheduled].start).toHaveBeenCalledWith(0.05);
        });

        it('should not stop segments that have already ended on reset', () => {
            const { handler } = setup();
            handler.handleAudioChunk(pcm([0]), { sampleRate: 24000 });
            flushPcm();
            createdSources[0].onended?.();

            handler.resetAudioState();
            expect(createdSources[0].stop).not.toHaveBeenCalled();
        });

        it('should not schedule PCM while recording', () => {
            const { handler } = setup();
            handler.toggleRecording();
            handler.handleAudioChunk(pcm([0]), { sampleRate: 24000 });
            flushPcm();

            expect(createdSources).toHaveLength(0);
        });
    });

    describe('AudioContext state recovery', () => {
        it('should resume an iOS "interrupted" context', async () => {
            // iOS Safari は着信や Siri の後に "interrupted" になる。
            // "suspended" しか見ていないと復帰できず、読み上げが無音になる。
            const { handler } = setup();
            handler.initAudioContext();
            await handler.resumeAudioContext();
            const ctx = (window as unknown as { __lastCtx?: MockAudioContext }).__lastCtx;
            expect(ctx).toBeDefined();

            (ctx as unknown as { state: string }).state = 'interrupted';
            ctx!.resume.mockClear();
            await handler.resumeAudioContext();
            expect(ctx!.resume).toHaveBeenCalledTimes(1);
        });

        it('should not try to resume a closed context', async () => {
            const { handler } = setup();
            handler.initAudioContext();
            const ctx = (window as unknown as { __lastCtx?: MockAudioContext }).__lastCtx;
            (ctx as unknown as { state: string }).state = 'closed';
            await handler.resumeAudioContext();
            expect(ctx!.resume).not.toHaveBeenCalled();
        });
    });

    describe('recording suppresses playback (barge-in)', () => {
        it('should stop the bot voice when recording starts', async () => {
            const { handler } = setup();
            // ボットが発話中
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            expect(createdSources).toHaveLength(1);

            // 発話中にマイクを押す（録音開始）と再生中の音声を止める
            handler.toggleRecording();
            expect(createdSources[0].stop).toHaveBeenCalled();
        });

        it('should not play audio chunks that arrive while recording', async () => {
            const { handler } = setup();
            handler.toggleRecording(); // 録音開始
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            // 録音中はボットの発話を再生しない（マイクが自分の音声を拾わないように）
            expect(createdSources).toHaveLength(0);
        });

        it('should abort a chunk that finishes decoding after recording starts', async () => {
            const { handler } = setup();
            handler.handleAudioChunk(new ArrayBuffer(2));
            // decode の待機中（await 前）に録音を開始する
            handler.toggleRecording();
            await flush();
            // decode 完了後も再生（source 生成）されない
            expect(createdSources).toHaveLength(0);
        });

        it('should keep the interrupted response silent after recording stops without sending', async () => {
            // 録音で割り込んだ応答の続きが、何も送らずに録音を止めた後に鳴り出さないようにする
            const { handler } = setup();
            const rec = createdRecognitions[0];
            handler.toggleRecording(); // 録音開始
            rec.onend!(); // 録音終了（onend で isRecording が false になる）
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            expect(createdSources).toHaveLength(0);
        });

        it('should play the next response after recording stops and a question is sent', async () => {
            const { handler } = setup();
            const rec = createdRecognitions[0];
            handler.toggleRecording();
            rec.onend!();
            handler.beginResponse();
            handler.handleAudioChunk(new ArrayBuffer(2));
            await flush();
            expect(createdSources).toHaveLength(1);
        });
    });

    describe('audio session (iOS)', () => {
        // iOS はマイクを使うと録音と再生を同時に行うモードのままになり、以後の読み上げに雑音が乗る
        let session: { type: string };

        beforeEach(() => {
            session = { type: 'auto' };
            Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
        });

        afterEach(() => {
            delete (navigator as unknown as { audioSession?: unknown }).audioSession;
        });

        it('should switch to play-and-record before recognition starts', () => {
            const { handler } = setup();
            const rec = createdRecognitions[0];
            let typeAtStart = '';
            rec.start.mockImplementationOnce(() => {
                typeAtStart = session.type;
            });

            handler.toggleRecording();
            expect(typeAtStart).toBe('play-and-record');
        });

        it('should switch back to playback before the recognized text is sent', () => {
            let typeWhenSent = '';
            const { handler } = setup({
                onRecordingEnd: vi.fn(() => {
                    typeWhenSent = session.type;
                }),
            });
            const rec = createdRecognitions[0];

            handler.toggleRecording();
            rec.onend!();
            // 質問の送信（= 読み上げの開始）より前に再生用のモードへ戻っている
            expect(typeWhenSent).toBe('playback');
        });

        it('should switch back to playback on a recognition error', () => {
            const { handler } = setup();
            const rec = createdRecognitions[0];

            handler.toggleRecording();
            rec.onerror!({ error: 'no-speech' });
            expect(session.type).toBe('playback');
        });

        it('should switch back to playback when recognition fails to start', () => {
            const { handler } = setup();
            const rec = createdRecognitions[0];
            rec.start.mockImplementationOnce(() => {
                throw new Error('InvalidStateError');
            });

            handler.toggleRecording();
            expect(session.type).toBe('playback');
        });

        it('should keep working when the browser has no audio session API', () => {
            delete (navigator as unknown as { audioSession?: unknown }).audioSession;
            const { handler } = setup();
            const rec = createdRecognitions[0];

            expect(handler.toggleRecording()).toBe(true);
            expect(() => rec.onend!()).not.toThrow();
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

        it('should return the resulting recording state on toggle', () => {
            const { handler } = setup();
            // 開始時は true、停止リクエスト時は false を返す
            expect(handler.toggleRecording()).toBe(true);
            expect(handler.toggleRecording()).toBe(false);
        });

        it('should not enter recording state and should report an error when start throws', () => {
            const { handler, opts } = setup();
            const rec = createdRecognitions[0];
            rec.start.mockImplementationOnce(() => {
                throw new Error('InvalidStateError');
            });

            // start が失敗したら録音状態にならず false を返す
            expect(handler.toggleRecording()).toBe(false);
            expect(opts.onError).toHaveBeenCalledWith(expect.any(Error));

            // 状態がずれていないので、次の toggle で再度 start を試みられる
            expect(handler.toggleRecording()).toBe(true);
            expect(rec.start).toHaveBeenCalledTimes(2);
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

        it('should join Japanese transcripts by stripping recognizer-inserted spaces', () => {
            const { opts } = setup({ language: 'ja' });
            const rec = createdRecognitions[0];

            // 認識エンジンはフレーズ間にスペース（半角・全角）を挿入することがある。
            // 日本語はスペースで区切らないため、プレビュー段階から除去して繋げる。
            rec.onresult!(
                makeResultEvent(0, [{ transcript: 'こんにちは 今日は　いい天気', isFinal: false }]),
            );
            expect(opts.onTranscript).toHaveBeenLastCalledWith('こんにちは今日はいい天気');

            rec.onresult!(
                makeResultEvent(0, [{ transcript: 'こんにちは 今日は いい天気 ですね', isFinal: true }]),
            );
            rec.onend!();
            expect(opts.onRecordingEnd).toHaveBeenCalledWith('こんにちは今日はいい天気ですね');
        });

        it('should join Japanese final segments without spaces between them', () => {
            const { opts } = setup({ language: 'ja' });
            const rec = createdRecognitions[0];

            // 複数の確定セグメントが先頭スペース付きで届いても繋がった文章になる
            // （event.results は累積なので 2 回目は resultIndex=1 で新規分のみ加算される）
            rec.onresult!(makeResultEvent(0, [{ transcript: 'おはよう', isFinal: true }]));
            rec.onresult!(
                makeResultEvent(1, [
                    { transcript: 'おはよう', isFinal: true },
                    { transcript: ' ございます', isFinal: true },
                ]),
            );

            rec.onend!();
            expect(opts.onRecordingEnd).toHaveBeenCalledWith('おはようございます');
        });

        it('should preserve spaces for English transcripts', () => {
            const { opts } = setup({ language: 'en' });
            const rec = createdRecognitions[0];

            rec.onresult!(makeResultEvent(0, [{ transcript: 'good morning everyone', isFinal: true }]));
            rec.onend!();
            expect(opts.onRecordingEnd).toHaveBeenCalledWith('good morning everyone');
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
