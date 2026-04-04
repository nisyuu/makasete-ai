import { describe, it, expect } from 'vitest';
import { stripTags, removeMarkdownLinks, cleanupForTTS, isSsml, hasTags } from './text';

describe('text utilities', () => {
    describe('stripTags', () => {
        it('should remove HTML/SSML tags', () => {
            expect(stripTags('<speak>Hello</speak>')).toBe('Hello');
            expect(stripTags('<div>Some <p>nested</p> content</div>')).toBe('Some nested content');
        });

        it('should handle text without tags', () => {
            expect(stripTags('Hello World')).toBe('Hello World');
        });
    });

    describe('removeMarkdownLinks', () => {
        it('should convert markdown links to plain text', () => {
            expect(removeMarkdownLinks('Visit [Google](https://google.com)')).toBe('Visit Google');
            expect(removeMarkdownLinks('Multiple [one](link1) and [two](link2)')).toBe('Multiple one and two');
        });

        it('should handle spaces between brackets', () => {
            expect(removeMarkdownLinks('Link [with space] (https://link.com)')).toBe('Link with space');
        });

        it('should escape ampersands', () => {
            expect(removeMarkdownLinks('Me & You')).toBe('Me &amp; You');
        });
    });

    describe('cleanupForTTS', () => {
        it('should remove links and markdown symbols', () => {
            const input = 'Check out [this link](https://example.com)! *Important* #heading';
            expect(cleanupForTTS(input)).toBe('Check out this link! Important heading');
        });

        it('should remove emojis', () => {
            expect(cleanupForTTS('Hello 😊👋')).toBe('Hello');
        });

        it('should remove relative paths', () => {
            expect(cleanupForTTS('File is at /usr/local/bin/node')).toBe('File is at');
        });
        
        it('should collapse multiple spaces', () => {
            expect(cleanupForTTS('Too   many    spaces')).toBe('Too many spaces');
        });
    });

    describe('isSsml', () => {
        it('should detect SSML', () => {
            expect(isSsml('<speak>Hello</speak>')).toBe(true);
            expect(isSsml('  <speak>Hello</speak>')).toBe(true);
            expect(isSsml('Hello')).toBe(false);
        });
    });

    describe('hasTags', () => {
        it('should detect presence of tags', () => {
            expect(hasTags('Text with <tag>')).toBe(true);
            expect(hasTags('Plain text')).toBe(false);
        });
    });
});
