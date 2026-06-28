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
    expect(getRecommendations('shirt', data, 3)).toHaveLength(3);
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
