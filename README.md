# Makasete AI

Google GeminiとElevenLabsを活用した、ECサイト向け音声対話チャットボットウィジェット。

## 特徴
- **リアルタイム音声対話**: ユーザーの音声を認識し、AIが音声で応答します。
- **低遅延**: ストリーミング処理により、スムーズな会話を実現。
- **簡単導入**: 既存のサイトにスクリプトタグを1行追加するだけで導入可能。
- **商品提案**: Google Sheetsの商品データを参照し、的確な提案を行います。

## 仕組み

本システムは、ECサイトに埋め込む **Widget（フロントエンド）** と、AI処理を行う **Server（バックエンド）** で構成されています。

### フロントエンド (Widget)
- **技術スタック**: Vanilla TypeScript, Web Components (Shadow DOM), CSS
- **音声認識**: ブラウザ標準の Web Speech API を使用し、ユーザーの発話をテキスト化してサーバーへ送信します。
- **音声再生**: MediaSource API (`audio/mpeg`, iOSの場合は`audio/mp4; codecs="mp4a.40.2"`) を使用し、サーバーからストリーミングされる音声データを順次バッファリングして再生します。
- **通信**: Socket.io Client を使用し、低遅延な双方向通信を実現しています。

### バックエンド (Server)
- **技術スタック**: Node.js, Express, Socket.io
- **AI処理**:
    - **LLM (大規模言語モデル)**: Google Gemini API を使用し、ユーザーの意図理解と自然な応答生成を行います。
    - **音声合成 (TTS)**: ElevenLabs API を使用し、生成されたテキストを高品質な日本語音声にストリーミング変換します。
- **データ連携**: Google Sheets API を使用し、商品データベースとしてスプレッドシートを参照・検索します。これにより、簡単に商品情報の管理・更新が可能です。

### データフロー
1. **ユーザー入力**: マイク（音声）またはテキスト入力。
2. **送信**: Widget -> Server (WebSocket)。
3. **推論 & 検索**: Server -> Gemini (商品情報はGoogle Sheetsを検索)。
4. **応答生成**: Geminiが応答テキストを生成。
5. **音声合成**: 生成されたテキスト -> ElevenLabs -> 音声データ。
6. **ストリーミング**: 音声データとテキストチャンク -> Widget。
7. **再生**: Widgetが順次音声とテキストを出力。

## 開発環境セットアップ

### 前提条件
- Node.js (v24+)
- Yarn (Berry/v4)
- [Google Cloud Project](https://cloud.google.com/?hl=ja)
- [ElevenLabs Account](https://elevenlabs.io/)

### インストール
```bash
yarn install
```

### 環境変数
`.env` ファイルを作成し、以下の変数を設定してください。
```
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

ECサイトのHTMLの `</body>` タグの直前に以下のスクリプトタグを追加してください。
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
