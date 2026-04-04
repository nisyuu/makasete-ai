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

    it('should preserve regular text with ampersands', () => {
      const input = 'Fish & Chips';
      const output = formatMessageText(input);
      expect(output).toBe('Fish &amp; Chips');
    });
  });
});
