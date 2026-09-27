export interface Product {
  name: string;
  description: string;
  price: string;
  image_url: string;
  url: string;
  tags: string;
}

/** サーバーがヘッダ無しの PCM（16bit・リトルエンディアン・モノラル）で音声を送るときの形式 */
export interface PcmFormat {
  sampleRate: number;
}
