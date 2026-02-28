# Makasete Bot

Google GeminiとElevenLabsを活用した、ECサイト向け音声対話チャットボットウィジェット。

## 特徴
- **リアルタイム音声対話**: ユーザーの音声を認識し、AIが人間のように自然な音声で応答します。
- **低遅延ストリーミング**: Geminiの回答を句読点ごとに分割して音声合成。ユーザーを待たせない高速なレスポンス。
- **動的プロンプト管理**: スプレッドシートの `prompt` シートを書き換えるだけで、AIの性格や接客スタイルを即座に変更可能。
- **商品提案**: スプレッドシートの商品データを参照し、最新の在庫状況や詳細情報を元に提案を行います。
- **コスト最適化**: Cloud SchedulerとWorkflowにより、夜間などの不要な時間帯はインスタンスを自動停止。

## 仕組み

本システムは、サイトに埋め込む **Widget（フロントエンド）** と、AI処理を行う **Server（バックエンド）** で構成されています。

### フロントエンド (Widget)
- **技術スタック**: Vanilla TypeScript, Web Components (Shadow DOM), CSS, Vite
- **音声認識**: Web Speech API を使用。
- **音声再生**: MediaSource API (fMP4/AAC) を使用。全てのブラウザ（Safari含む）で高品質なストリーミング再生を実現。
- **通信**: Socket.io を使用した双方向通信。

### バックエンド (Server)
- **技術スタック**: Node.js (v24), Express, Socket.io
- **AI処理**:
    - **LLM**: Google Gemini API (gemini-2.5-flash)
    - **TTS**: ElevenLabs API (高品質な日本語音声)
- **データ連携**: Google Sheets API (商品情報・システムプロンプトの取得)

## 開発環境セットアップ

### 前提条件
- Node.js (v24+)
- pnpm (v10+)
- Google Cloud プロジェクト (Cloud Run, Secret Manager, etc.)
- ElevenLabs アカウント

### インストール
```bash
pnpm install
```

### 環境設定
1. プロジェクトルートに `.env` を作成し、以下を設定します。
```env
GOOGLE_SHEETS_ID=your_sheet_id
GEMINI_API_KEY=your_gemini_key
ELEVENLABS_API_KEY=your_elevenlabs_key
ALLOWED_ORIGINS=http://localhost:3000,https://your-site.com
```
2. ローカル開発用のサービスアカウントキーを `google-key.json` としてルートに配置します。

### 起動
```bash
# サーバーとウィジェットの同時起動
pnpm dev

# 型チェック
pnpm typecheck

# リンター
pnpm lint
```

## 埋め込み方法

ECサイトの `</body>` タグの直前に以下のスクリプトを追加してください。

```html
<script src="https://[YOUR_CLOUD_RUN_URL]/public/widget.js"></script>
```

## デプロイ (Google Cloud Run)

Terraformを使用してデプロイします。

1. **Dockerイメージのビルドとプッシュ**:
   ```bash
   gcloud builds submit --tag asia-northeast1-docker.pkg.dev/[PROJECT_ID]/makasete-bot-repo/makasete-bot:latest
   ```
2. **Terraformの適用**:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```

### 自動スケール
`terraform/scheduler.tf` により、毎日 09:00 (JST) に起動し、21:00 (JST) に自動停止するスケジュールが設定されます。
