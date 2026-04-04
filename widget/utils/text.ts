/**
 * Utility functions for widget-side text processing.
 */

/**
 * Normalizes keys for settings matching (lowercase and removes non-alphanumeric chars).
 * Example: "Chat Title" -> "chattitle"
 */
export function normalizeSettingKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Formats raw text into safe HTML, escaping potential XSS and converting markdown links.
 */
export function formatMessageText(rawText: string): string {
  // 1. Escape HTML to prevent basic XSS
  const escapeHtml = (str: string) => {
    return str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m] || m,
    );
  };

  // 2. Safe URL check for Markdown links
  // Only allow http, https, and relative paths. Block javascript:, etc.
  const sanitizeUrl = (url: string) => {
    const trimmed = url.trim();
    if (/^(https?:\/\/|\/)/i.test(trimmed)) {
      return trimmed;
    }
    return "#";
  };

  // First, escape the entire text
  const escapedText = escapeHtml(rawText);

  // Then, selectively allow Markdown links [text](url)
  return escapedText.replace(
    /\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g,
    (_match, linkText, url) => {
      const safeUrl = sanitizeUrl(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
    },
  );
}
