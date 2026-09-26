import { describe, it, expect } from 'vitest';
import { normalizeSettingKey, formatMessageText } from './text';

describe('widget text utilities', () => {
  describe('normalizeSettingKey', () => {
    it('should lowercase and remove non-alphanumeric chars', () => {
      expect(normalizeSettingKey('Chat Title')).toBe('chattitle');
      expect(normalizeSettingKey('Initial_Message')).toBe('initialmessage');
      expect(normalizeSettingKey('User-Count')).toBe('usercount');
      expect(normalizeSettingKey('TITLE')).toBe('title');
    });
  });

  describe('formatMessageText', () => {
    it('should escape HTML tags to prevent XSS', () => {
      const input = '<script>alert("xss")</script><b>Bold</b>';
      const output = formatMessageText(input);
      expect(output).toContain('&lt;script&gt;');
      expect(output).toContain('&lt;b&gt;');
      expect(output).not.toContain('<script>');
    });

    it('should convert valid markdown links to <a> tags', () => {
      const input = 'Visit [Google](https://google.com)';
      const output = formatMessageText(input);
      expect(output).toBe('Visit <a href="https://google.com" target="_blank" rel="noopener noreferrer">Google</a>');
    });

    it('should sanitize dangerous URLs in markdown links', () => {
      const input = 'Click [here](javascript:alert("xss"))';
      const output = formatMessageText(input);
      expect(output).toContain('href="#"');
      expect(output).not.toContain('javascript:');
    });

    it('should handle relative paths in markdown links', () => {
      const input = 'Check [this](/local/path)';
      const output = formatMessageText(input);
      expect(output).toContain('href="/local/path"');
    });

    it('should block backslash and whitespace tricks that browsers normalize', () => {
      // ブラウザはバックスラッシュをスラッシュに直し、タブや改行を取り除くため、
      // これらは「相対パス」のふりをして外部サイトへ飛ぶ
      for (const url of ['/\\evil.example/x', '/\t/evil.example/x', '/\n/evil.example/x', '/\\\\evil.example']) {
        const output = formatMessageText(`[bank](${url})`);
        expect(output).toContain('href="#"');
        expect(output).not.toContain('evil.example');
      }
    });

    it('should block protocol-relative URLs that point to another host', () => {
      // "//evil.example" は先頭が "/" なので素朴な相対パス判定をすり抜け、
      // 表示テキストと遷移先が食い違うリンクになる。
      const output = formatMessageText('Click [your bank](//evil.example/login)');
      expect(output).toContain('href="#"');
      expect(output).not.toContain('evil.example/login"');
    });

    it('should block backslash-prefixed and whitespace-padded dangerous URLs', () => {
      expect(formatMessageText('[x](  javascript:alert(1))')).toContain('href="#"');
      expect(formatMessageText('[x](data:text/html,<script>)')).toContain('href="#"');
      expect(formatMessageText('[x](vbscript:msgbox)')).toContain('href="#"');
    });

    it('should still allow absolute http and https links', () => {
      expect(formatMessageText('[a](http://shop.example/x)')).toContain(
        'href="http://shop.example/x"',
      );
      expect(formatMessageText('[a](https://shop.example/x)')).toContain(
        'href="https://shop.example/x"',
      );
    });

    it('should preserve regular text with ampersands', () => {
      const input = 'Fish & Chips';
      const output = formatMessageText(input);
      expect(output).toBe('Fish &amp; Chips');
    });
  });
});
