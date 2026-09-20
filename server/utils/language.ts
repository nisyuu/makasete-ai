/**
 * クライアントから届く language をホワイトリストで正規化する。
 *
 * 言語別の設定は `Record<string, string>` のプレーンオブジェクトで持っているため、
 * `LANGUAGE_PROMPTS[language] ?? LANGUAGE_PROMPTS.ja` のような参照は
 * `language = "constructor"` や `"toString"` でプロトタイプ由来の値を拾い、
 * `??` のフォールバックをすり抜けてしまう。結果としてプロンプトや TTS の
 * リクエストに関数オブジェクトが混入し、API エラーになる。
 * 入口で既知の値だけに絞ることで、この経路を塞ぐ。
 */
export const SUPPORTED_LANGUAGES = ["ja", "en"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = "ja";

/** 既知の言語コードならそのまま、それ以外は既定値（ja）を返す。 */
export function resolveLanguage(value: unknown): SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
    ? (value as SupportedLanguage)
    : DEFAULT_LANGUAGE;
}
