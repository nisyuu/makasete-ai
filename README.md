# EC Voice Assistant Widget

Google GeminiとElevenLabsを活用した、ECサイト向け音声対話チャットボットウィジェット。

## 特徴
- **リアルタイム音声対話**: ユーザーの音声を認識し、AIが音声で応答します。
- **低遅延**: ストリーミング処理により、スムーズな会話を実現。
- **簡単導入**: 既存のサイトにスクリプトタグを1行追加するだけで導入可能。
- **商品提案**: Google Sheetsの商品データを参照し、的確な提案を行います。

## 開発環境セットアップ

### 前提条件
- Node.js (v18+)
- Yarn (Berry/v4)
- Google Cloud Project (Gemini access)
- ElevenLabs Account

### インストール
```bash
yarn install
```

### 環境変数
`.env` ファイルを作成し、以下の変数を設定してください。
```
PORT=8080
GOOGLE_SHEETS_ID=your_sheet_id
GEMINI_API_KEY=your_gemini_key
ELEVENLABS_API_KEY=your_elevenlabs_key
```

### 起動
```bash
# 開発サーバー (Backend + Widget Watch is not unified, run separately or use simple dev)
# バックエンド
yarn start

# ウィジェットビルド
yarn build:widget
```

## 既存サイトへの埋め込み方

ECサイトのHTMLの `<body>` タグの直前に以下のスクリプトタグを追加してください。
`YOUR_CLOUD_RUN_URL` はデプロイ後のURLに置き換えてください。

```html
<script src="https://YOUR_CLOUD_RUN_URL/public/widget.js"></script>
```

### 動作確認用デモ
ローカルで動作確認する場合は、`dist/public/widget.js` が生成された後、`widget/demo.html` を修正してブラウザで開くか、バックエンドを起動して `http://localhost:8080/public/widget.js` にアクセスできることを確認してください。

## デプロイ (Google Cloud Run)

Terraformを使用してデプロイします。

1. DockerイメージをビルドしてContainer Registry/Artifact Registryにプッシュします。
2. `terraform/terraform.tfvars` を作成し、必要な変数を定義します。
3. `terraform apply` を実行します。

```bash
cd terraform
terraform init
terraform apply
```
