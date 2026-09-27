import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
interface HistoryEntry {
    role: string;
    parts: { text: string }[];
}
const sendMessageStream = vi.fn();
const startChat = vi.fn((_opts: { history: HistoryEntry[]; systemInstruction: HistoryEntry }) => ({ sendMessageStream }));
const getGenerativeModel = vi.fn(() => ({ startChat }));

vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(function () {
        return { getGenerativeModel };
    }),
}));

vi.mock('./sheets', () => ({
    getSystemPrompt: vi.fn(() => ''),
}));

import { buildSystemInstruction, generateResponseStream, initGemini } from './gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSystemPrompt } from './sheets';
import { config } from '../config';

describe('Gemini service utilities', () => {
    describe('buildSystemInstruction', () => {
        it('should construct a system prompt with sheet data', () => {
            const basePrompt = 'You are a helpful assistant.';
            const allData = new Map([
                ['products', [
                    { id: '1', name: 'Apple' },
                    { id: '2', name: 'Banana' }
                ]]
            ]);

            const result = buildSystemInstruction(basePrompt, allData);

            expect(result).toContain(basePrompt);
            expect(result).toContain('### PRODUCTS');
            expect(result).toContain('id: 1, name: Apple');
            expect(result).toContain('id: 2, name: Banana');
        });

        it('should handle empty sheets', () => {
            const basePrompt = 'Prompt';
            const allData = new Map([
                ['empty', []]
            ]);

            const result = buildSystemInstruction(basePrompt, allData);
            expect(result).not.toContain('### EMPTY');
        });

        it('should omit empty values in rows', () => {
            const allData = new Map([
                ['test', [{ key: 'value', empty: '' }]]
            ]);
            const result = buildSystemInstruction('Base', allData);
            expect(result).toContain('key: value');
            expect(result).not.toContain('empty:');
        });

        it('should respect the maxRowsPerSheet limit', () => {
            const original = config.maxRowsPerSheet;
            config.maxRowsPerSheet = 2;
            const allData = new Map([
                ['many', [
                    { id: '1' },
                    { id: '2' },
                    { id: '3' },
                ]]
            ]);
            const result = buildSystemInstruction('Base', allData);
            expect(result).toContain('id: 1');
            expect(result).toContain('id: 2');
            expect(result).not.toContain('id: 3');
            config.maxRowsPerSheet = original;
        });
    });

    describe('initGemini', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should log an error and not initialize when the API key is missing', () => {
            const original = config.geminiApiKey;
            config.geminiApiKey = '';
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            initGemini();

            expect(errSpy).toHaveBeenCalledWith('GEMINI_API_KEY is missing');
            expect(GoogleGenerativeAI).not.toHaveBeenCalled();
            config.geminiApiKey = original;
            errSpy.mockRestore();
        });

        it('should construct the client when the API key is present', () => {
            const original = config.geminiApiKey;
            config.geminiApiKey = 'test-key';

            initGemini();

            expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-key');
            expect(getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-3.5-flash' });
            config.geminiApiKey = original;
        });
    });

    describe('generateResponseStream', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            config.geminiApiKey = 'test-key';
            sendMessageStream.mockResolvedValue({ stream: 'mock-stream' });
        });

        it('should pass the abort signal to sendMessageStream when given', async () => {
            const controller = new AbortController();
            await generateResponseStream('Hello', new Map(), [], 'ja', controller.signal);
            expect(sendMessageStream).toHaveBeenCalledWith('Hello', { signal: controller.signal });
        });

        it('should start a chat and return the stream', async () => {
            const allData = new Map([['faq', [{ q: 'hi' }]]]);
            const stream = await generateResponseStream('Hello', allData, [], 'ja');

            expect(stream).toBe('mock-stream');
            expect(startChat).toHaveBeenCalledTimes(1);
            expect(sendMessageStream).toHaveBeenCalledWith('Hello');
        });

        it('should pass the system prompt as systemInstruction, not as a chat turn', async () => {
            (getSystemPrompt as ReturnType<typeof vi.fn>).mockReturnValue('Base system prompt');
            const allData = new Map<string, Record<string, string>[]>();
            await generateResponseStream('Q', allData, [{ role: 'user', parts: [{ text: 'prev' }] }], 'ja');

            const opts = startChat.mock.calls[0][0];
            expect(opts.systemInstruction.parts[0].text).toContain('Base system prompt');
            expect(opts.systemInstruction.parts[0].text).toContain('日本語で回答してください。');
            // 会話履歴にはユーザーの履歴だけが入る
            expect(opts.history).toEqual([{ role: 'user', parts: [{ text: 'prev' }] }]);
        });

        it('should drop leading model turns so the history starts with a user turn', async () => {
            const allData = new Map<string, Record<string, string>[]>();
            await generateResponseStream('Q', allData, [
                { role: 'model', parts: [{ text: 'orphan' }] },
                { role: 'user', parts: [{ text: 'u1' }] },
                { role: 'model', parts: [{ text: 'm1' }] },
            ]);

            const historyArg = startChat.mock.calls[0][0].history;
            expect(historyArg.map((t) => t.parts[0].text)).toEqual(['u1', 'm1']);
        });

        it('should use the English language prompt', async () => {
            const allData = new Map<string, Record<string, string>[]>();
            await generateResponseStream('Q', allData, [], 'en');

            const opts = startChat.mock.calls[0][0];
            expect(opts.systemInstruction.parts[0].text).toContain('Please respond in English.');
        });

        it('should fall back to the Japanese prompt for an unknown language', async () => {
            const allData = new Map<string, Record<string, string>[]>();
            await generateResponseStream('Q', allData, [], 'fr');

            const opts = startChat.mock.calls[0][0];
            expect(opts.systemInstruction.parts[0].text).toContain('日本語で回答してください。');
        });

        it('should use a default base prompt when getSystemPrompt is empty', async () => {
            (getSystemPrompt as ReturnType<typeof vi.fn>).mockReturnValue('');
            const allData = new Map<string, Record<string, string>[]>();
            await generateResponseStream('Q', allData, []);

            const opts = startChat.mock.calls[0][0];
            expect(opts.systemInstruction.parts[0].text).toContain('あなたは親切なAIアシスタントです。');
        });

        it('should rethrow and log when sendMessageStream fails', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            sendMessageStream.mockRejectedValue(new Error('boom'));
            const allData = new Map<string, Record<string, string>[]>();

            await expect(generateResponseStream('Q', allData, [])).rejects.toThrow('boom');
            expect(errSpy).toHaveBeenCalledWith('Gemini Error:', 'boom');
            errSpy.mockRestore();
        });
    });
});
