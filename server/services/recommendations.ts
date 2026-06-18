import { SheetData } from './sheets';

export interface Product {
  name: string;
  description: string;
  price: string;
  image_url: string;
  url: string;
  tags: string;
}

const PRODUCT_SHEET_NAMES = ['products', '商品', 'product', 'items'];

export function findProductsSheet(allData: Map<string, SheetData[]>): SheetData[] | null {
  for (const name of PRODUCT_SHEET_NAMES) {
    const sheet = allData.get(name);
    if (sheet && sheet.length > 0) return sheet;
  }
  for (const [name, data] of allData.entries()) {
    if ((name.toLowerCase().includes('product') || name.includes('商品')) && data.length > 0) {
      return data;
    }
  }
  return null;
}

function rowToProduct(row: SheetData): Product {
  return {
    name: row.name || row.product_name || row['商品名'] || '',
    description: row.description || row.desc || row['説明'] || '',
    price: row.price || row['価格'] || row['金額'] || '',
    image_url: row.image_url || row.image || row['画像'] || row['画像url'] || '',
    url: row.url || row.link || row['リンク'] || '',
    tags: row.tags || row.tag || row['タグ'] || '',
  };
}

function scoreProduct(query: string, product: Product): number {
  const queryLower = query.toLowerCase();
  const tokens = queryLower
    .split(/[\s,、。！？　]+/)
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return 0;

  const productText = [product.name, product.description, product.tags]
    .join(' ')
    .toLowerCase();

  return tokens.reduce((score, token) => score + (productText.includes(token) ? 1 : 0), 0);
}

/**
 * Returns up to maxResults products from the products sheet that are relevant
 * to the user's query, ranked by keyword overlap score.
 */
export function getRecommendations(
  userText: string,
  allData: Map<string, SheetData[]>,
  maxResults = 3,
): Product[] {
  const sheet = findProductsSheet(allData);
  if (!sheet) return [];

  return sheet
    .map((row) => {
      const product = rowToProduct(row);
      return { product, score: scoreProduct(userText, product) };
    })
    .filter(({ product, score }) => score > 0 && product.name.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ product }) => product);
}
