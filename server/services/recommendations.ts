import { SheetData } from './sheets';

export interface Product {
  name: string;
  description: string;
  price: string;
  image_url: string;
  url: string;
  tags: string;
}

export interface RecommendationContext {
  /**
   * Full text of the assistant's answer. Product names mentioned in it are
   * treated as the strongest relevance signal, so the cards follow what the
   * assistant actually recommended instead of raw keyword overlap.
   */
  responseText?: string;
  maxResults?: number;
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

// Words too generic to indicate which product the user is talking about.
// They appear both in product descriptions and in questions about anything
// ("おすすめの商品を教えて", "show me some products"), so a match on them
// alone must not surface a card. Voice input in particular arrives
// whitespace-segmented, turning these into standalone tokens.
const GENERIC_WORDS = new Set([
  // Japanese
  'おすすめ', 'オススメ', 'お勧め', '商品', '製品', 'アイテム', '人気', '定番',
  '教えて', 'ください', '下さい', 'お願いします', 'お願い',
  'あります', 'ありますか', 'ありません', 'ほしい', '欲しい', 'したい',
  'します', 'できます', 'できますか', 'です', 'ですか', 'ます',
  'どんな', 'どれ', 'どの', 'これ', 'それ', 'なに', 'なにか', '何か',
  '見せて', '探して', '探しています', 'こんにちは', 'ありがとう',
  // English
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those',
  'what', 'which', 'have', 'has', 'want', 'show', 'tell', 'give', 'find',
  'please', 'recommend', 'recommended', 'recommendation', 'recommendations',
  'popular', 'product', 'products', 'item', 'items', 'goods',
  'any', 'some', 'about', 'you', 'your', 'can', 'could', 'would', 'should',
  'like', 'need', 'there', 'are', 'was', 'were', 'not', 'yes', 'hello',
  'thanks', 'thank', 'of', 'to', 'in', 'on', 'it', 'my', 'me', 'no', 'or',
  'we', 'us', 'at', 'by', 'an', 'as', 'be', 'if', 'so', 'do', 'am', 'is',
]);

function tokenize(text: string): string[] {
  // Split on ASCII whitespace/punctuation first, then split each part on
  // ideographic space (U+3000); drop short and generic tokens.
  const tokens = text
    .toLowerCase()
    .split(/[\s,、。！？?!]+/)
    .flatMap((t) => t.split(String.fromCodePoint(0x3000)))
    .filter((t) => t.length >= 2 && !GENERIC_WORDS.has(t));
  return [...new Set(tokens)];
}

function parseTags(tags: string): string[] {
  return tags
    .toLowerCase()
    .split(/[,、/／・|;；\s]+/)
    .filter((t) => t.length >= 2);
}

function scoreProduct(
  product: Product,
  tokens: string[],
  userTextLower: string,
  responseTextLower: string,
): number {
  const name = product.name.trim().toLowerCase();
  const description = product.description.toLowerCase();
  const tags = parseTags(product.tags);

  // A verbatim mention of the product name in the user's message or in the
  // assistant's answer ties the card to what the conversation is actually
  // about — the strongest relevance signal.
  const mentioned =
    name.length >= 2 && (userTextLower.includes(name) || responseTextLower.includes(name));

  const nameHits = tokens.filter((t) => name.includes(t)).length;
  // Tags are curated keywords, so match them in both directions: a query
  // token inside a tag, or a tag inside the raw query. Japanese queries are
  // not whitespace-segmented, so token-based matching alone would miss them.
  const tagHits = tags.filter(
    (tag) => userTextLower.includes(tag) || tokens.some((t) => tag.includes(t)),
  ).length;
  const descriptionHits = tokens.filter((t) => description.includes(t)).length;

  // A single description-only hit is usually coincidence (a phrase shared
  // with an unrelated question), so require identifying evidence: a mention,
  // a name/tag hit, or at least two distinct description hits.
  const isRelevant = mentioned || nameHits > 0 || tagHits > 0 || descriptionHits >= 2;
  if (!isRelevant) return 0;

  return (mentioned ? 4 : 0) + nameHits * 3 + tagHits * 2 + descriptionHits;
}

/**
 * Returns up to maxResults products relevant to the conversation, ranked by
 * evidence strength. A product qualifies only when it is identifiably
 * related: its name is mentioned in the user's message or the assistant's
 * answer, a curated tag matches, a query keyword hits the product name, or
 * several distinct keywords appear in its description. A weak single-keyword
 * overlap in the description no longer surfaces a card.
 */
export function getRecommendations(
  userText: string,
  allData: Map<string, SheetData[]>,
  context: RecommendationContext = {},
): Product[] {
  const { responseText = '', maxResults = 3 } = context;
  const sheet = findProductsSheet(allData);
  if (!sheet) return [];

  const tokens = tokenize(userText);
  const userTextLower = userText.toLowerCase();
  const responseTextLower = responseText.toLowerCase();

  return sheet
    .map((row) => {
      const product = rowToProduct(row);
      return {
        product,
        score: scoreProduct(product, tokens, userTextLower, responseTextLower),
      };
    })
    .filter(({ product, score }) => score > 0 && product.name.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ product }) => product);
}
