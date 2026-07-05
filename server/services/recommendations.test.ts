import { describe, it, expect } from 'vitest';
import { findProductsSheet, getRecommendations } from './recommendations';
import type { SheetData } from './sheets';

function makeProductSheet(rows: SheetData[]): Map<string, SheetData[]> {
  return new Map([['products', rows]]);
}

describe('findProductsSheet', () => {
  it('should return null when there are no matching sheets', () => {
    const data = new Map([['faq', [{ question: 'Q', answer: 'A' }]]]);
    expect(findProductsSheet(data)).toBeNull();
  });

  it('should find the sheet by exact name "products"', () => {
    const rows = [{ name: 'Widget', price: '¥1,000' }];
    const data = new Map([['products', rows]]);
    expect(findProductsSheet(data)).toBe(rows);
  });

  it('should find the sheet by exact name "商品"', () => {
    const rows = [{ name: 'Widget' }];
    const data = new Map([['商品', rows]]);
    expect(findProductsSheet(data)).toBe(rows);
  });

  it('should find a sheet whose name contains "product"', () => {
    const rows = [{ name: 'Widget' }];
    const data = new Map([['my_products_list', rows]]);
    expect(findProductsSheet(data)).toBe(rows);
  });

  it('should prefer exact name matches over partial matches', () => {
    const exact = [{ name: 'A' }];
    const partial = [{ name: 'B' }];
    const data = new Map<string, SheetData[]>([
      ['my_products_list', partial],
      ['products', exact],
    ]);
    expect(findProductsSheet(data)).toBe(exact);
  });

  it('should return null for an empty products sheet', () => {
    const data = new Map([['products', []]]);
    expect(findProductsSheet(data)).toBeNull();
  });
});

describe('getRecommendations', () => {
  it('should return empty array when there is no products sheet', () => {
    expect(getRecommendations('shirt', new Map())).toEqual([]);
  });

  it('should return empty array when no products match the query', () => {
    const data = makeProductSheet([
      { name: 'Laptop', description: 'computer', tags: '' },
    ]);
    expect(getRecommendations('shirt', data)).toEqual([]);
  });

  it('should return matching products sorted by score', () => {
    const data = makeProductSheet([
      { name: 'Blue T-Shirt', description: 'cotton shirt', tags: 'shirt,clothing' },
      { name: 'Laptop Bag', description: 'bag for laptop', tags: 'bag,tech' },
      { name: 'Red Shirt', description: 'polyester shirt', tags: 'shirt,clothing' },
    ]);
    const results = getRecommendations('shirt cotton', data);
    expect(results[0].name).toBe('Blue T-Shirt');
    expect(results.map((p) => p.name)).toContain('Red Shirt');
    expect(results.map((p) => p.name)).not.toContain('Laptop Bag');
  });

  it('should return at most maxResults products', () => {
    const rows: SheetData[] = Array.from({ length: 10 }, (_, i) => ({
      name: `Shirt${i}`,
      description: 'shirt',
      tags: 'shirt',
    }));
    const data = makeProductSheet(rows);
    expect(getRecommendations('shirt', data, { maxResults: 3 })).toHaveLength(3);
  });

  it('should skip rows with no name', () => {
    const data = makeProductSheet([
      { name: '', description: 'shirt item', tags: 'shirt' },
      { name: 'Nice Shirt', description: 'cotton shirt', tags: 'shirt' },
    ]);
    const results = getRecommendations('shirt', data);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Nice Shirt');
  });

  it('should handle non-standard column names (product_name, desc, etc.)', () => {
    const data = makeProductSheet([
      {
        product_name: 'Scarf',
        desc: 'warm scarf',
        価格: '¥500',
        image_url: '',
        url: '',
        tags: 'scarf',
      },
    ]);
    const results = getRecommendations('scarf', data);
    expect(results[0].name).toBe('Scarf');
    expect(results[0].description).toBe('warm scarf');
    expect(results[0].price).toBe('¥500');
  });

  it('should match Japanese product names', () => {
    const data = makeProductSheet([
      { name: 'シャツ', description: '綿素材のシャツ', tags: '衣類' },
    ]);
    const results = getRecommendations('シャツ', data);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('シャツ');
  });
});

describe('relevance filtering (unrelated cards must not appear)', () => {
  const coffeeShop = makeProductSheet([
    { name: 'ブレンドコーヒー', description: '当店人気のおすすめ商品です', tags: 'コーヒー,ドリンク' },
    { name: '抹茶ラテ', description: '宇治抹茶を使った人気のドリンク', tags: '抹茶,ラテ' },
  ]);

  it('should not show cards when only generic words match the description', () => {
    // 音声入力は分かち書きされるため「おすすめ」「商品」が単独トークンになり、
    // 説明文の常套句と偶然一致してしまう（修正前は全商品が表示された）
    expect(getRecommendations('おすすめ の 商品 を 教えて ください', coffeeShop)).toEqual([]);
  });

  it('should not show a card for a single coincidental description hit', () => {
    const data = makeProductSheet([
      { name: '高級腕時計', description: '防水仕様の高級腕時計です', tags: '時計' },
    ]);
    // 「防水」しか一致しない無関係な質問ではカードを出さない
    expect(getRecommendations('防水 の スマホケース は ありますか', data)).toEqual([]);
  });

  it('should not show cards for an unrelated question', () => {
    expect(getRecommendations('営業時間を教えてください', coffeeShop)).toEqual([]);
  });

  it('should show only products mentioned in the assistant response', () => {
    // クエリ自体に商品キーワードがなくても、AIが実際に勧めた商品はカードにする
    const results = getRecommendations('何かおすすめはありますか', coffeeShop, {
      responseText: '当店自慢のブレンドコーヒーはいかがでしょうか。',
    });
    expect(results.map((p) => p.name)).toEqual(['ブレンドコーヒー']);
  });

  it('should match curated tags inside unsegmented Japanese queries', () => {
    // 分かち書きされない日本語でもタグ（タグ⊆発話）で照合できる
    const results = getRecommendations('コーヒーはありますか', coffeeShop);
    expect(results.map((p) => p.name)).toEqual(['ブレンドコーヒー']);
  });

  it('should show a product whose name appears in the user message', () => {
    const results = getRecommendations('抹茶ラテの値段を教えて', coffeeShop);
    expect(results.map((p) => p.name)).toEqual(['抹茶ラテ']);
  });

  it('should show products matching multiple description keywords', () => {
    const data = makeProductSheet([
      { name: 'トラベルバッグ', description: '軽量で防水の大容量バッグ', tags: '' },
      { name: '腕時計', description: '防水仕様', tags: '' },
    ]);
    // 説明文に複数の具体語が一致する商品は関連ありとみなす
    const results = getRecommendations('軽量 で 防水 の かばん', data);
    expect(results.map((p) => p.name)).toEqual(['トラベルバッグ']);
  });

  it('should not count duplicated query tokens as multiple hits', () => {
    const data = makeProductSheet([
      { name: '腕時計', description: '防水仕様のモデル', tags: '' },
    ]);
    // 同じ語の繰り返しは「複数語一致」の根拠にしない
    expect(getRecommendations('防水 防水 ケース', data)).toEqual([]);
  });
});
