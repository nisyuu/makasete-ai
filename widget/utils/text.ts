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
 * URL に含まれてはいけない文字（バックスラッシュと制御文字）が無いかを調べる。
 *
 * ブラウザはバックスラッシュをスラッシュとして解釈し、タブや改行は URL から
 * 取り除く。そのため "/\evil.example" や "/<TAB>/evil.example" は相対パスに
 * 見えて実際には外部サイトへ飛ぶ。
 */
function hasUnsafeUrlChars(url: string): boolean {
  if (url.includes("\\")) return true;
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
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
  // Only allow http, https, and same-origin relative paths. Block javascript:, etc.
  const sanitizeUrl = (url: string) => {
    const trimmed = url.trim();

    // ブラウザの URL 解釈に合わせて、先に危険な文字を落とす。
    // バックスラッシュはスラッシュとして扱われ、タブや改行は取り除かれるため、
    // "/\evil.example" や "/<TAB>/evil.example" は「相対パス」のふりをして
    // 外部サイトへ飛ぶ。制御文字ごと拒否する。
    if (hasUnsafeUrlChars(trimmed)) {
      return "#";
    }

    // スラッシュ 1 個で始まるものだけを同一サイトの相対パスとして許可する。
    // "//evil.example/..." は先頭が "/" でもプロトコル相対 URL で、
    // 任意の外部ホストへのリンクになる。
    if (/^\/(?!\/)/.test(trimmed)) {
      return trimmed;
    }

    if (/^https?:\/\//i.test(trimmed)) {
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
