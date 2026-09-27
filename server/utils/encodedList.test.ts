import { describe, it, expect } from 'vitest';
import { decodeEncodedList, encodeList } from './encodedList';

describe('decodeEncodedList', () => {
    it('should round-trip a list including Japanese names', () => {
        const encoded = encodeList(['settings', 'よくある質問', 'items']);
        // シェルや --set-env-vars にそのまま載る文字だけで構成される
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeEncodedList(encoded)).toEqual(['settings', 'よくある質問', 'items']);
    });

    it('should trim entries and drop empty ones and duplicates', () => {
        expect(decodeEncodedList(encodeList([' a ', '', 'a', 'b']))).toEqual(['a', 'b']);
    });

    it('should accept padded base64url', () => {
        const padded = Buffer.from('["a"]').toString('base64url') + '=';
        expect(decodeEncodedList(padded)).toEqual(['a']);
    });

    it('should reject characters outside base64url', () => {
        // 通常の base64 の + や /、シェルの記号は受け付けない
        expect(decodeEncodedList('abc+/')).toBeNull();
        expect(decodeEncodedList('abc;rm')).toBeNull();
    });

    it('should reject values that are not a JSON array of strings', () => {
        expect(decodeEncodedList(Buffer.from('not json').toString('base64url'))).toBeNull();
        expect(decodeEncodedList(Buffer.from('{"a":1}').toString('base64url'))).toBeNull();
        expect(decodeEncodedList(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
    });

    it('should reject oversized lists and entries', () => {
        expect(decodeEncodedList(encodeList(Array.from({ length: 51 }, (_, i) => `s${i}`)))).toBeNull();
        expect(decodeEncodedList(encodeList(['x'.repeat(201)]))).toBeNull();
    });
});
