/**
 * settings シート由来の生データから、ウィジェット表示に反映する設定を抽出する。
 */
import { normalizeSettingKey } from "./text";

export interface WidgetSettings {
  /** チャットヘッダーのタイトル */
  title?: string;
  /** 初回に表示する挨拶メッセージ */
  initialMessage?: string;
  /** プライマリカラー（Shadow Host の --primary-color に適用） */
  primaryColor?: string;
}

type SettingsRow = Record<string, string>;

function isRecord(value: unknown): value is SettingsRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `/api/settings` のレスポンス（settings シートの内容）から設定を取り出す。
 *
 * 以下の2形式に対応する:
 *  - key-value 形式: `[{ key: "primary_color", value: "#FF0000" }, ...]`
 *  - 列形式（単一行）: `[{ primary_color: "#FF0000", initial_message: "...", ... }]`
 *
 * キーは {@link normalizeSettingKey} で正規化して照合するため、
 * `Primary Color` / `primary_color` / `primaryColor` などの表記揺れを吸収する。
 * 該当する設定が無い（または空文字）の場合は undefined を返し、呼び出し側の
 * デフォルト値にフォールバックできるようにする。
 */
export function parseSettings(data: unknown): WidgetSettings {
  if (!Array.isArray(data) || data.length === 0) return {};

  const first = data[0];
  if (!isRecord(first)) return {};

  const map = new Map<string, string>();
  const isKeyValue = "key" in first && "value" in first;

  if (isKeyValue) {
    for (const row of data) {
      if (!isRecord(row) || !row.key) continue;
      map.set(normalizeSettingKey(String(row.key)), String(row.value ?? "").trim());
    }
  } else {
    for (const [key, value] of Object.entries(first)) {
      map.set(normalizeSettingKey(key), String(value ?? "").trim());
    }
  }

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = map.get(key);
      if (value) return value;
    }
    return undefined;
  };

  return {
    title: pick("chattitle", "title"),
    initialMessage: pick("initialmessage", "greeting"),
    primaryColor: pick("primarycolor", "color"),
  };
}
