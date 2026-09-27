/**
 * base64url で包んだ JSON 文字列配列の読み取り。
 *
 * テナントごとの設定（公開シート・許可サイト）は、platform の Cloud Build トリガーが
 * `gcloud run deploy --set-env-vars` で渡す。値はトリガーの `bash -c` に埋め込まれ、
 * `--set-env-vars` はカンマで変数を区切るため、生の値だとシート名の日本語や記号、
 * リストの区切りを安全に運べない。base64url は英数字と `-` `_` だけで表せるので、
 * シェルにも `--set-env-vars` にもそのまま載る。
 */

/** リストの最大件数。設定画面の上限より大きめに取り、それを超える値は壊れているとみなす */
const MAX_ENTRIES = 50;

/** 1 件あたりの最大文字数 */
const MAX_ENTRY_LENGTH = 200;

/**
 * base64url（パディングなしも可）の JSON 文字列配列を読む。
 * 形式が崩れている場合は null を返す。呼び出し側で安全な側に倒すこと。
 */
export function decodeEncodedList(raw: string): string[] | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length > MAX_ENTRIES) return null;

  const entries: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed === "") continue;
    if (trimmed.length > MAX_ENTRY_LENGTH) return null;
    if (!entries.includes(trimmed)) entries.push(trimmed);
  }
  return entries;
}

/** テストや手元での設定用に、文字列配列を base64url の JSON にする */
export function encodeList(entries: string[]): string {
  return Buffer.from(JSON.stringify(entries), "utf8").toString("base64url");
}
