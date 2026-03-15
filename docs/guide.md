---
marp: true
theme: default
paginate: true
header: Makasete AI 導入ガイド
footer: © 2026 Makasete AI Project
---

# Makasete AI 導入ガイド
### EC/サービスサイト向け音声対話チャットボット

---

## Makasete AI とは？

Google Gemini を活用した、**リアルタイム音声対話**が可能なチャットボットウィジェットです。

スプレッドシートを更新するだけで、AIの知識や性格を即座に変更できる柔軟性が特徴です。

---

## 1. 主な機能

- **リアルタイム音声対話**: ユーザーの声を認識し、自然な音声で即座にレスポンス。
- **低遅延ストリーミング**: Gemini の回答を逐次音声合成。待ち時間を最小化。
- **動的コンテキスト管理**: スプレッドシート（Google Sheets）との連携により、商品情報やFAQをノーコードで更新可能。
- **マルチデバイス対応**: PC、スマホ（iOS/Android）の主要ブラウザで動作。

---

## 2. どんなことに使えるのか？

- **ECサイトの接客**: 商品選びの相談や、おすすめ商品の提案。
- **カスタマーサポート**: よくある質問（FAQ）への音声回答。
- **サービス紹介**: 複雑なサービス内容を対話形式で分かりやすく説明。
- **店舗案内**: 営業時間やアクセス情報の提供。

---

## 3. 得られる効果

- **顧客体験（CX）の向上**: テキスト入力の手間を省き、より直感的で温かみのある対話を提供。
- **コンバージョン率の改善**: AIによる適切な商品提案により、購買意欲を促進。
- **運用コストの削減**: スプレッドシートを書き換えるだけで知識ベースを更新できるため、開発者の工数を削減。
- **インフラコストの最適化**: 稼働スケジュール設定により、不要な時間帯のコストを自動カット。

---

## 4. システム構成

### フロントエンド (Widget)
- Vanilla TypeScript / Web Components
- 音声認識: Web Speech API

### バックエンド (Server)
- Node.js (Express) / Socket.io
- LLM: Google Gemini API (2.5-flash)
- TTS: Google Cloud Text-to-Speech / ElevenLabs

### インフラ
- Google Cloud Run / Cloud Scheduler
- Google Sheets API (Knowledge Base)

---

## 5. 導入方法 (1/2)

### サーバーのデプロイ
1. **Google Cloud の準備**: Cloud Run, Secret Manager などを有効化。
2. **Terraform の実行**:
   ```bash
   cd terraform
   terraform apply
   ```
3. **スプレッドシートの紐付け**: ボットごとに `GOOGLE_SHEETS_ID` を設定。

---

## 5. 導入方法 (2/2)

### サイトへの埋め込み
ECサイトの `</body>` タグ直前に、以下のスクリプトを追加するだけで完了です。

```html
<script src="https://[YOUR_CLOUD_RUN_URL]/public/widget.js"></script>
```

---

## まとめ

Makasete AI は、最新のAI技術を手軽に、そして安価にサイトへ導入できるソリューションです。

音声による新しい接客体験を、あなたのサイトにも。

---

# Q&A / お問い合わせ
詳細は [GitHub リポジトリ](https://github.com/nisyuu/makasete-ai) を参照してください。
