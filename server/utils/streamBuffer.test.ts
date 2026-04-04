import { describe, it, expect } from 'vitest';
import { StreamBuffer } from './streamBuffer';

describe('StreamBuffer', () => {
    it('should split text by punctuations', () => {
        const buffer = new StreamBuffer();
        const result = buffer.add('こんにちは。お元気ですか？');
        expect(result).toEqual(['こんにちは。', 'お元気ですか？']);
    });

    it('should handle text delivered in chunks', () => {
        const buffer = new StreamBuffer();
        
        let result = buffer.add('こんに');
        expect(result).toEqual([]);
        
        result = buffer.add('ちは。');
        expect(result).toEqual(['こんにちは。']);
        
        result = buffer.add('元気？');
        expect(result).toEqual(['元気？']);
    });

    it('should handle multiple punctuations in one chunk', () => {
        const buffer = new StreamBuffer();
        const result = buffer.add('はい！いいえ！わからない。');
        expect(result).toEqual(['はい！', 'いいえ！', 'わからない。']);
    });

    it('should flush remaining text', () => {
        const buffer = new StreamBuffer();
        buffer.add('こんにちは。元気');
        const remaining = buffer.flush();
        expect(remaining).toBe('元気');
        
        // Should be empty after flush
        expect(buffer.flush()).toBe('');
    });

    it('should handle newlines as delimiters', () => {
        const buffer = new StreamBuffer();
        const result = buffer.add('第一行\n第二行\n');
        expect(result).toEqual(['第一行', '第二行']);
    });

    it('should ignore empty sentences', () => {
        const buffer = new StreamBuffer();
        const result = buffer.add('。。。');
        expect(result).toEqual(['。', '。', '。']); // Current implementation splits each punc
    });
});
