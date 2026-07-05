import { getInternalSheetData, SheetData } from './sheets';

// Sheet names (optionally prefixed with "private_" to keep the settings out
// of the AI's knowledge context) that hold operator-managed feature settings.
const SETTINGS_SHEET_NAMES = ['settings', '設定'];

// Keys accepted for the product-card toggle. Values live in sheet cells, so
// Japanese aliases survive header normalization and are safe to support.
const PRODUCT_CARDS_KEYS = ['show_product_cards', 'product_cards', '商品カード表示', '商品カード'];

const TRUE_VALUES = new Set([
  'true', 'on', '1', 'yes', 'enabled', '有効', 'オン', '表示', 'する', 'はい',
]);
const FALSE_VALUES = new Set([
  'false', 'off', '0', 'no', 'none', 'disabled', '無効', 'オフ', '非表示', 'なし', 'しない', 'いいえ',
]);

export function findSettingsSheet(allData: Map<string, SheetData[]>): SheetData[] | null {
  for (const [name, data] of allData.entries()) {
    const normalized = name.trim().toLowerCase().replace(/^private_/, '');
    if (SETTINGS_SHEET_NAMES.includes(normalized) && data.length > 0) {
      return data;
    }
  }
  return null;
}

/**
 * Looks up a setting value from the settings sheet. Rows are key-value pairs
 * (columns `key`/`name`/`setting` and `value`/`val`/`enabled`). Returns null
 * when the sheet or the key is absent.
 */
export function getSettingValue(allData: Map<string, SheetData[]>, key: string): string | null {
  const sheet = findSettingsSheet(allData);
  if (!sheet) return null;

  const wanted = key.trim().toLowerCase();
  for (const row of sheet) {
    const rowKey = (row.key || row.name || row.setting || '').trim().toLowerCase();
    if (rowKey && rowKey === wanted) {
      return row.value ?? row.val ?? row.enabled ?? '';
    }
  }
  return null;
}

/**
 * Interprets an operator-entered toggle value ("on"/"off", "true"/"FALSE",
 * "オン"/"非表示", ...). Unknown or missing values fall back to defaultValue
 * so a typo in the sheet never silently disables a feature.
 */
export function parseBooleanSetting(value: string | null, defaultValue: boolean): boolean {
  if (value === null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}

/**
 * Whether product recommendation cards may be shown in the chat. Controlled
 * from the spreadsheet's settings sheet (key `show_product_cards`); defaults
 * to enabled when no settings sheet or key exists, preserving prior behavior.
 * Reads the internal cache so a `private_settings` sheet also works.
 */
export function isProductCardsEnabled(
  allData: Map<string, SheetData[]> = getInternalSheetData(),
): boolean {
  for (const key of PRODUCT_CARDS_KEYS) {
    const value = getSettingValue(allData, key);
    if (value !== null) return parseBooleanSetting(value, true);
  }
  return true;
}
