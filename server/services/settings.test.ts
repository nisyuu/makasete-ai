import { describe, it, expect } from 'vitest';
import {
  findSettingsSheet,
  getSettingValue,
  parseBooleanSetting,
  isProductCardsEnabled,
} from './settings';
import type { SheetData } from './sheets';

function makeSettingsSheet(
  rows: SheetData[],
  sheetName = 'settings',
): Map<string, SheetData[]> {
  return new Map([[sheetName, rows]]);
}

describe('findSettingsSheet', () => {
  it('should return null when there is no settings sheet', () => {
    const data = new Map([['products', [{ name: 'A' }]]]);
    expect(findSettingsSheet(data)).toBeNull();
  });

  it('should find the sheet by name "settings"', () => {
    const rows = [{ key: 'x', value: '1' }];
    expect(findSettingsSheet(makeSettingsSheet(rows))).toBe(rows);
  });

  it('should find the sheet by Japanese name "設定"', () => {
    const rows = [{ key: 'x', value: '1' }];
    expect(findSettingsSheet(makeSettingsSheet(rows, '設定'))).toBe(rows);
  });

  it('should find a private_ prefixed settings sheet', () => {
    // private_ を付けると AI のコンテキストに設定内容が渡らない（既存機構）
    const rows = [{ key: 'x', value: '1' }];
    expect(findSettingsSheet(makeSettingsSheet(rows, 'private_settings'))).toBe(rows);
  });

  it('should ignore an empty settings sheet', () => {
    expect(findSettingsSheet(makeSettingsSheet([]))).toBeNull();
  });
});

describe('getSettingValue', () => {
  it('should return the value for a matching key', () => {
    const data = makeSettingsSheet([{ key: 'show_product_cards', value: 'off' }]);
    expect(getSettingValue(data, 'show_product_cards')).toBe('off');
  });

  it('should match keys case-insensitively and ignore surrounding spaces', () => {
    const data = makeSettingsSheet([{ key: ' Show_Product_Cards ', value: 'ON' }]);
    expect(getSettingValue(data, 'show_product_cards')).toBe('ON');
  });

  it('should support name/setting as key columns and val/enabled as value columns', () => {
    const byName = makeSettingsSheet([{ name: 'feature_x', val: 'yes' }]);
    expect(getSettingValue(byName, 'feature_x')).toBe('yes');
    const bySetting = makeSettingsSheet([{ setting: 'feature_y', enabled: 'no' }]);
    expect(getSettingValue(bySetting, 'feature_y')).toBe('no');
  });

  it('should return null for a missing key', () => {
    const data = makeSettingsSheet([{ key: 'other', value: '1' }]);
    expect(getSettingValue(data, 'show_product_cards')).toBeNull();
  });
});

describe('parseBooleanSetting', () => {
  it.each(['true', 'TRUE', 'on', '1', 'yes', '有効', 'オン', '表示', 'する', 'はい'])(
    'should parse "%s" as true',
    (value) => {
      expect(parseBooleanSetting(value, false)).toBe(true);
    },
  );

  it.each(['false', 'FALSE', 'off', '0', 'no', '無効', 'オフ', '非表示', 'なし', 'しない'])(
    'should parse "%s" as false',
    (value) => {
      expect(parseBooleanSetting(value, true)).toBe(false);
    },
  );

  it('should fall back to the default for unknown or missing values', () => {
    // シート上の入力ミスで機能が黙って無効化されないようにする
    expect(parseBooleanSetting('maybe', true)).toBe(true);
    expect(parseBooleanSetting('maybe', false)).toBe(false);
    expect(parseBooleanSetting(null, true)).toBe(true);
  });
});

describe('isProductCardsEnabled', () => {
  it('should default to enabled when there is no settings sheet', () => {
    expect(isProductCardsEnabled(new Map())).toBe(true);
  });

  it('should default to enabled when the key is absent', () => {
    const data = makeSettingsSheet([{ key: 'other_setting', value: 'off' }]);
    expect(isProductCardsEnabled(data)).toBe(true);
  });

  it('should be disabled when show_product_cards is off', () => {
    const data = makeSettingsSheet([{ key: 'show_product_cards', value: 'off' }]);
    expect(isProductCardsEnabled(data)).toBe(false);
  });

  it('should be enabled when show_product_cards is on', () => {
    const data = makeSettingsSheet([{ key: 'show_product_cards', value: 'on' }]);
    expect(isProductCardsEnabled(data)).toBe(true);
  });

  it('should accept the Japanese alias key with a Japanese value', () => {
    const data = makeSettingsSheet([{ key: '商品カード表示', value: '非表示' }]);
    expect(isProductCardsEnabled(data)).toBe(false);
  });

  it('should work with a private_settings sheet', () => {
    const data = makeSettingsSheet(
      [{ key: 'show_product_cards', value: 'off' }],
      'private_settings',
    );
    expect(isProductCardsEnabled(data)).toBe(false);
  });
});
