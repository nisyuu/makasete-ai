# Makasete AI

Makasete AIは、スプレッドシートで管理できるAIチャットボットです。
ECサイトやサービスサイトに簡単導入でき、音声とテキストの両方でユーザーと対話できます。

**[📖 導入ガイド（スライド）はこちら](https://nisyuu.github.io/makasete-ai/)**

## 特徴

- **リアルタイム音声対話**: ユーザーの音声を認識し、AIが自然な音声で応答します。
- **低遅延ストリーミング**: Geminiの回答を句読点ごとに分割して音声合成。ユーザーを待たせない高速なレスポンス。
- **動的コンテキスト管理**: スプレッドシートを書き換えるだけで、AIの性格（プロンプト）、商品データ、よくある質問 (FAQ)、サービス紹介を即座に変更可能。
- **マルチデバイス対応**: PCおよびスマートフォン（iOS/Android）の主要ブラウザで動作。
- **コスト最適化**: Cloud Schedulerにより、夜間などの不要な時間帯はインスタンスを自動停止。

## 仕組み

本システムは、サイトに埋め込む **Widget（フロントエンド）** と、AI処理を行う **Server（バックエンド）** で構成されています。

### フロントエンド (Widget)

- **技術スタック**: Vanilla TypeScript, Web Components (Shadow DOM), CSS, Vite
- **音声認識**: Web Speech API を使用。
- **音声再生**: **Web Audio API** を使用。デコード済みのオーディオバッファを直接再生することで、ブラウザ特有の冒頭の音欠け（クリッピング）を防止し、低遅延な再生を実現。
- **通信**: Socket.io を使用した双方向通信。

### バックエンド (Server)

- **技術スタック**: Node.js (v24), Express, Socket.io, **LangChain (LangGraph)**
- **AI処理**:
  - **LLM**: Google Gemini API (gemini-3.5-flash)
  - **オーケストレーション**: LangChain / LangGraph によるエージェント構成
  - **TTS**: Google Cloud Text-to-Speech (デフォルト, Chirp 3: HD ボイス) または ElevenLabs API
- **データ連携**: Google Sheets API (商品情報・FAQ・サービス紹介・システムプロンプトの取得)

## 自律型開発エージェント (Autonomous Agent)

本プロジェクトには、GitHub Issue や Pull Request を元に、自律的にコード修正・テスト・PR作成を行うエージェントが搭載されています。

- **技術スタック**: LangGraph, Claude Sonnet 4.6 (Anthropic)
- **2つの実行モード**:
  1. **自動モード (`ai-power` ラベル)**:
     - Issue に `ai-power` ラベルを付与すると自動起動。
     - コード分析、プラン作成、修正、テストを最大 5 回まで繰り返し、最終的な修正を Pull Request として送信。
  2. **対話モード (`@claude` メンション)**:
     - Issue または Pull Request のコメントで `@claude` とメンションすることで起動（リポジトリオーナーのみ）。
     - **意図判定**: 「コード修正（IMPLEMENT）」か「会話・質問（CHAT）」かを自動判別。
     - **会話モード**: コードを修正せず、質問への回答や実装方針のアドバイスをコメントで返信。
     - **実装モード**: 指示に従ってファイルを修正。PR 上でのメンション時は、その PR のブランチを自動で更新（Push）し、実行結果をコメントで報告。
- **実行環境**: GitHub Actions (`.github/workflows/autonomous-agent.yml`, `.github/workflows/claude.yml`)

## セキュリティ対策

本プロジェクトでは、本番環境での運用を考慮し、ソースコードレベルで以下のセキュリティ対策を実装しています。

- **プロキシ信頼設定**: Cloud Run などのリバースプロキシ経由でも正しくクライアントの IP アドレスを取得できるよう `trust proxy` を設定し、正確なレート制限を可能にしています。
- **HTTP レート制限**: `express-rate-limit` を導入し、15分間に 100 リクエストを超える過剰な API アクセスを遮断します。
- **WebSocket 接続制限**: 同一 IP アドレスからの同時接続数を 5 件までに制限し、リソースの枯渇（DoS攻撃）を防いでいます。
- **機密データの保護**: スプレッドシートの `prompt` シート（AIの性格設定等）は API 経由で公開されないよう、エンドポイント側でアクセスをブロックしています。

## 開発環境セットアップ

### 前提条件

- Node.js (v24+)
- pnpm (v10+)
- Google Cloud プロジェクト (Cloud Run, Secret Manager, Text-to-Speech API, etc.)

### インストール

```bash
pnpm install
```

### 環境設定

1. プロジェクトルートに `.env` を作成し、以下を設定します。

```env
GOOGLE_SHEETS_ID=your_sheet_id
GEMINI_API_KEY=your_gemini_key
ALLOWED_ORIGINS=http://localhost:3000,https://your-site.com
# オプション
TTS_PROVIDER=gemini # (default) or elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key # elevenlabs使用時のみ
```

2. サービスアカウントキー（Google Sheets/TTS用）を `google-key.json` としてルートに配置します。

### 起動

```bash
# サーバーとウィジェットの同時起動
pnpm dev

# 型チェック
pnpm typecheck

# リンター
pnpm lint

# 任意のTypeScriptスクリプトを実行 (tsx)
pnpm tsx path/to/script.ts
```

## 埋め込み方法

ECサイトの `</body>` タグの直前に以下のスクリプトを追加してください。

```html
<script src="https://[YOUR_CLOUD_RUN_URL]/public/widget.js"></script>
```

ウィジェットは既定で **スクリプトの読み込み元（= Cloud Run の URL）** に接続します。埋め込み先サイトのドメインには接続しないため、上記のタグを追加するだけで動作します。

接続先を明示的に指定したい場合は `data-server-url` 属性を使用してください。

```html
<script
  src="https://[YOUR_CLOUD_RUN_URL]/public/widget.js"
  data-server-url="https://[YOUR_CLOUD_RUN_URL]"
></script>
```

> **注意**: 埋め込み先サイトからの接続はクロスオリジンになるため、サーバー側の環境変数 `ALLOWED_ORIGINS` に埋め込み先サイトの origin（例: `https://example.com`）を含める必要があります。

## スプレッドシートの構成

本システムは、指定された `GOOGLE_SHEETS_ID` のスプレッドシートから以下のシートを参照します。各シートの1行目はヘッダーとして扱われます。**カラム名や数は自由に追加・変更が可能**です（AIが自動的に読み込みます）。

| シート名   | 役割                 | 構成例（1行目）                                        |
| :--------- | :------------------- | :----------------------------------------------------- |
| `prompt`   | AIの性格・接客ルール | (カラム定義なし。A1セルにプロンプト全文を記載)         |
| `books`    | 商品リスト           | `id`, `title`, `category`, `price`, `description` など |
| `faqs`     | よくある質問         | `question`, `answer`, `category` など                  |
| `services` | サービス紹介         | `title`, `description`, `price_range` など             |
| `news`     | お知らせ             | `id`, `title`, `date` など                             |
| `settings` | 機能設定             | `key`, `value`（下記「settingsシート」参照）           |

※ シートが存在しない場合は、そのカテゴリの情報がないものとして処理されます。
※ カラム名をスペースありで作成した場合（例：`Product Name`）、内部的にスネークケース（`product_name`）に変換されます。

### 注意事項

- **行数制限**: 1シートあたり読み込まれるのは **先頭の100行まで** です。膨大なデータを扱う場合は、情報を絞り込んで記載してください。
- **シート名**: シート名がそのままAIへの知識カテゴリ名（例：`### FAQS`）として渡されます。AIが理解しやすい名前（英単語など）を付けることを推奨します。
- **データ更新**: スプレッドシートを更新した後は、サーバーの再起動または [GASによる再デプロイ](#スプレッドシート連携-gas) を行うまで反映されません。
- **promptシート**: `prompt` シートのみ特殊な扱いとなり、A1セルの内容がシステムプロンプトとして使用されます。

### settingsシート（機能設定）

`settings`（または `設定`）という名前のシートを作成すると、チャットの挙動をスプレッドシートから制御できます。1行目のヘッダーは `key` / `value` とし、2行目以降に設定を記載します。

| key                  | value の例      | 説明                                                             |
| :------------------- | :-------------- | :--------------------------------------------------------------- |
| `show_product_cards` | `on` / `off`    | チャットへの商品レコメンドカード表示のオン/オフ（既定: `on`）    |

- `value` には `on`/`off` のほか `true`/`false`、`1`/`0`、`表示`/`非表示`、`有効`/`無効` なども使用できます。不明な値の場合は既定値で動作します。
- key は `商品カード表示` という日本語名でも指定できます。
- 設定内容を AI の知識コンテキストに含めたくない場合は、シート名を `private_settings` にしてください（`private_` 付きシートは AI に渡されません）。

## API エンドポイント

スプレッドシートの各シート（`prompt`を除く）のデータは、以下のエンドポイントからJSON形式で取得できます。

- **URL**: `GET /api/:sheetName`
- **例**: `/api/books`, `/api/news`
- **レスポンス**: シートの全行データ（最大100行）をJSON配列で返します。存在しないシート名を指定した場合は `404 Not Found` となります。

## デプロイ (Google Cloud Run)

Terraformを使用してデプロイします。本システムは、複数のスプレッドシート（Makaseteサーバー）を同時にホストすることが可能です。

1. **Dockerイメージのビルドとプッシュ**:
   初回のみ、手動でビルドとプッシュを行います。
   ```bash
   gcloud builds submit --tag asia-northeast1-docker.pkg.dev/[PROJECT_ID]/makasete-ai-repo/makasete-ai:latest
   ```
2. **環境設定 (`terraform/terraform.tfvars`)**:
   `terraform/terraform.tfvars.example` を参考に、Makaseteサーバーの設定およびGitHub連携設定を記述します。

   ```hcl
   project_id = "your-project-id"
   container_image = "asia-northeast1-docker.pkg.dev/..."

   github_repository    = "your-username/makasete-ai"
   github_connection_id = "your-github-connection-id" # Cloud Buildの接続ID

   makasete_servers = {
     # ...
   }
   ```

3. **Terraformの適用**:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```
   実行後、各Makaseteサーバーの URL および **Cloud Build トリガーID** が出力されます。このトリガーIDを後述のGAS設定で使用します。

## スプレッドシート連携 (GAS)

`gas/` ディレクトリには、Google スプレッドシートから直接サーバーの再構築（デプロイ）を実行するためのスクリプトが含まれています。これにより、プロンプトや商品データを更新した後に、エンジニアでなくてもワンクリックで最新の状態を反映させることが可能です。

### セットアップ

1. 対象のスプレッドシートのメニューから **[拡張機能] > [Apps Script]** を開きます。
2. `gas/main.js` の内容をエディタにコピー＆ペーストします。
3. スクリプト内の以下の変数を、自身の環境に合わせて書き換えます：
   - `PROJECT_ID`: Google Cloud のプロジェクトID
   - `TRIGGER_ID`: Cloud Build のトリガーID
4. 保存してスプレッドシートをリロードすると、メニューに **[🤖 Makasete AI]** が追加されます。

### 使い方

- スプレッドシートでプロンプトや商品リストを編集した後、**[🤖 Makasete AI] > [🚀 スプレッドシートの情報をMakasete AIに反映]** をクリックします。
- Cloud Build のトリガーが実行され、最新のソースコードとスプレッドシート情報でサーバーが自動的に再デプロイされます。

### 自動スケール

`terraform/scheduler.tf` により、毎日 09:00 (JST) に起動し、21:00 (JST) に自動停止するスケジュールが設定されます。
