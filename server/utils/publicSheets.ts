/**
 * `/api/:sheetName` で公開するシートの判定。
 *
 * これまでは `prompt` と `private_` 付き以外のすべてのシートを誰にでも返していた。
 * スプレッドシートは運営者が自由に増やせるため、社内向けのシートを作った時点で
 * その内容が公開される。接頭辞を付け忘れただけで漏れるのは事故になりやすい。
 *
 * そこで公開してよいシート名を明示する方式にする。PUBLIC_SHEETS に列挙し、
 * `*` を指定したときだけ従来どおり全シートを公開する。
 */

/** 列挙ではなく全公開を表す番兵 */
export const PUBLIC_ALL_SHEETS = "*";

/**
 * 既定で公開するシート。
 * settings はウィジェットが起動時に読む。items と news は利用実績がある。
 */
export const DEFAULT_PUBLIC_SHEETS = ["settings", "items", "news"] as const;

/** API から絶対に返さないシート（システムプロンプトが入る） */
const ALWAYS_PRIVATE = ["prompt"];

export function parsePublicSheets(
  raw: string | undefined,
): string[] | typeof PUBLIC_ALL_SHEETS {
  if (raw === undefined) return [...DEFAULT_PUBLIC_SHEETS];

  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.includes(PUBLIC_ALL_SHEETS)) return PUBLIC_ALL_SHEETS;
  return names;
}

/**
 * このシートを API から返してよいか。
 * `prompt` と `private_` 付きは、PUBLIC_SHEETS の指定に関わらず返さない。
 */
export function isSheetPublic(
  sheetName: string,
  publicSheets: string[] | typeof PUBLIC_ALL_SHEETS,
): boolean {
  if (ALWAYS_PRIVATE.includes(sheetName)) return false;
  if (sheetName.toLowerCase().startsWith("private_")) return false;
  if (publicSheets === PUBLIC_ALL_SHEETS) return true;
  return publicSheets.includes(sheetName);
}
