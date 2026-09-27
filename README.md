# Makasete AI

Makasete AIは、スプレッドシートで管理できるAIチャットボットです。
ECサイトやサービスサイトに簡単導入でき、音声とテキストの両方でユーザーと対話できます。

**[📖 導入ガイド（スライド）はこちら](https://nisyuu.github.io/makasete-ai/)**

## 特徴

- **リアルタイム音声対話**: ユーザーの音声を認識し、AIが自然な音声で応答します。
- **ストリーミング応答**: Geminiの回答を句読点ごとに逐次表示。音声は応答全体をまとめて合成し、文の境目でも抑揚が途切れない自然な読み上げ。
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

- **技術スタック**: Node.js (v24), Express, Socket.io
- **AI処理**:
  - **LLM**: Google Gemini API (gemini-3.8-flash)
  - **TTS**: Gemini 3.8 Flash Lite TTS (デフォルト)、Google Cloud Text-to-Speech (Chirp 3: HD ボイス)、または ElevenLabs API
- **データ連携**: Google Sheets API (商品情報・FAQ・サービス紹介・システムプロンプトの取得)

## 開発支援エージェント (Claude Code)

開発には、GitHub 上で動く [Claude Code Action](https://github.com/anthropics/claude-code-action) を使っています。

- **`@claude` メンション**: Issue や Pull Request（本文・コメント・レビュー）で `@claude` とメンションすると起動します（リポジトリオーナーのみ）。質問への回答や、コードの修正・PR ブランチへの push を行います。
- **`/review` コメント**: Pull Request に `/review` とコメントすると、コードレビューを実行します（リポジトリオーナーのみ）。
- **実行環境**: GitHub Actions (`.github/workflows/claude.yml`, `.github/workflows/claude-code-review.yml`)

## セキュリティ対策

本プロジェクトでは、本番環境での運用を考慮し、ソースコードレベルで以下のセキュリティ対策を実装しています。

- **プロキシ信頼設定**: リバースプロキシ経由でも正しくクライアントの IP アドレスを取得できるよう、信頼する段数を `TRUSTED_PROXY_COUNT` で設定します。**この値が実際の構成と合っていないと、全利用者が 1 つのキーにまとめられ、同時接続やレート制限の枠をサイト全体で共有してしまいます**（6 人目以降が接続できない、といった形で表面化します）。値の決め方は下記「プロキシ段数の確認」を参照してください。
- **HTTP レート制限**: `express-rate-limit` を導入し、過剰な API アクセスを遮断します。ウィジェット配信と読み取り API は緩め、それ以外は厳しめに、経路ごとに分けています。IPv6 は /56 単位でまとめ、送信元アドレスを変えるだけで回避されるのを防いでいます。
- **WebSocket 接続制限**: 同一クライアントからの同時接続数を制限します（既定 20、`MAX_CONNECTIONS_PER_CLIENT`）。
- **同時生成数の上限**: プロセス全体で同時に走る応答生成を制限します（既定 8、`MAX_CONCURRENT_GENERATIONS`）。クライアントの識別に依存しないため、プロキシ設定を誤っても LLM と TTS の費用に歯止めがかかります。
- **Origin 検証（任意）**: `ALLOWED_ORIGINS` に origin を列挙すると、HTTP の CORS と Socket.IO のハンドシェイクの両方で検証します。表記の揺れ（末尾スラッシュ・大文字）は正規化して比較します。埋め込み先を限定しない運用では `*` を指定し、この検証を無効にします。その場合の歯止めは、下記のレート制限と同時生成数の上限です。
- **機密データの保護**: スプレッドシートの `prompt` シート（AIの性格設定等）は API 経由で公開されないよう、エンドポイント側でアクセスをブロックしています。

### プロキシ段数の確認

`TRUSTED_PROXY_COUNT` は、X-Forwarded-For の右から何番目をクライアントの IP として扱うかを決めます。Cloud Run に直接つなぐ構成なら `1`、前段に Firebase App Hosting や外部ロードバランサ、CDN がある場合は `2` です。

実際の値は、デプロイ先で一度ログを確認して決めます。

1. 環境変数に `LOG_PROXY_HEADERS=true` を設定してデプロイします。
2. サイトを開き、ログを確認します。
   ```
   [proxy] http hops=1 chain=["203.0.113.5"] resolvedKey=203.0.113.5
   ```
   `hops` が `TRUSTED_PROXY_COUNT` と同じなら、その値で正しく動いています。
3. 次のような警告が出た場合は、`resolvedKey` が利用者ではなくプロキシの IP になっています。`TRUSTED_PROXY_COUNT` を `hops` と同じ値にしてください。
   ```
   [proxy] http hops=2 chain=["203.0.113.5","35.191.0.1"] resolvedKey=35.191.0.1 — expected hops=1. ...
   ```
4. 値が決まったら `LOG_PROXY_HEADERS` を外します。

ログは起動後の先頭 10 件だけ出力され、その後は止まります。

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
TTS_PROVIDER=gemini-flash-tts # (default) or gemini / elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key # elevenlabs使用時のみ
```

2. Google Sheets / TTS の認証は、鍵ファイルを使わずにサービスアカウントの権限を借りる方式（なりすまし）で行います。有効期限のない鍵ファイルを手元に置かないためです。

   ```bash
   gcloud auth application-default login \
     --impersonate-service-account=local-dev-sa@[PROJECT_ID].iam.gserviceaccount.com
   ```

   自分のアカウントに、`local-dev-sa` に対する「サービス アカウント トークン作成者」（`roles/iam.serviceAccountTokenCreator`）のロールが必要です。スプレッドシートは `local-dev-sa` に共有しておきます。`GOOGLE_APPLICATION_CREDENTIALS` は設定せず、`google-key.json` も置かないでください（どちらかがあると鍵ファイルが優先されます）。

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

SPA などでウィジェットが不要になったときは `window.MakaseteAIWidget.destroy()` を呼ぶと、接続・音声・イベントリスナーを解放してウィジェットを取り外せます。

> **注意**: 埋め込み先サイトからの接続はクロスオリジンになります。埋め込み先を限定する運用では、サーバー側の環境変数 `ALLOWED_ORIGINS` に埋め込み先サイトの origin（例: `https://example.com`）を列挙してください。HTTP の CORS と Socket.IO のハンドシェイクの両方で検証されます。
>
> 埋め込み先を限定しない運用では `ALLOWED_ORIGINS=*` を指定します。この場合 Origin の照合は行われないため、**費用の歯止めは IP 単位のレート制限（`MAX_CONNECTIONS_PER_CLIENT`、送信回数の上限）と同時生成数の上限（`MAX_CONCURRENT_GENERATIONS`）だけ** になります。次の点に注意してください。
>
> - Origin ヘッダはブラウザ以外のクライアントなら偽装できるため、origin を列挙する運用でも「ブラウザから第三者サイト経由での利用」を防ぐ手段にとどまります。
> - テナントごとの許可サイトは、platform から `ALLOWED_ORIGINS_B64` で渡します（下記「テナントごとの設定」）。
> - Gemini と TTS の予算アラートを設定しておくことを勧めます。

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
- **データ更新**: スプレッドシートを更新した後は、Makasete AI の管理画面（別リポジトリ `makasete-ai-platform`）から対象サーバーの再ビルドを実行するまで反映されません。
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
- **例**: `/api/items`, `/api/news`
- **レスポンス**: シートの全行データ（最大100行）をJSON配列で返します。存在しないシート名や公開対象外のシートを指定した場合は `404 Not Found` となります。

### 公開するシートの指定

環境変数 `PUBLIC_SHEETS` に、このエンドポイントから返すシート名をカンマ区切りで指定します。未設定の場合は `settings,items,news` です。

| 指定 | 挙動 |
| :--- | :--- |
| 未設定 | `settings` / `items` / `news` のみ公開 |
| `settings,items,faqs` | 列挙したシートのみ公開 |
| `*` | `prompt` と `private_*` 以外のすべてを公開 |

`prompt` と `private_` 付きのシートは、`*` を指定しても公開されません。

列挙方式にしているのは、運営者が社内向けのシートを追加したときに、`private_` の付け忘れだけで内容が公開されるのを防ぐためです。

### テナントごとの設定（platform から渡す値）

テナントごとの Cloud Run サービスは、別リポジトリ（`makasete-ai-platform`）の Cloud Build トリガーからデプロイされます。トリガーはシェルのコマンドに値を埋め込み、`--set-env-vars` はカンマで変数を区切ります。そのため platform からは、JSON の文字列配列を base64url で包んだ値を、次の環境変数で渡します。日本語のシート名もそのまま運べます。

| 環境変数 | 中身 | 優先 |
| :--- | :--- | :--- |
| `PUBLIC_SHEETS_B64` | 公開するシート名の配列（例: `["settings","よくある質問"]`） | `PUBLIC_SHEETS` より優先 |
| `ALLOWED_ORIGINS_B64` | 埋め込みを許可するサイトの origin の配列（例: `["https://shop.example"]`） | `ALLOWED_ORIGINS` より優先 |

- どちらも、空文字（未設定）なら従来の `PUBLIC_SHEETS` / `ALLOWED_ORIGINS` を使います。
- `*` は受け付けません。全公開や全許可は、運営者が `PUBLIC_SHEETS=*` / `ALLOWED_ORIGINS=*` で明示したときだけです。
- `ALLOWED_ORIGINS_B64` が空の配列なら、許可サイトが未登録として全サイトを許可します。
- 値が壊れている場合、公開シートは既定値に戻り、許可サイトはどのサイトも許可しません（設定ミスで公開範囲を広げないため）。

値は次のように作れます。

```bash
node -e 'console.log(Buffer.from(JSON.stringify(["https://shop.example"])).toString("base64url"))'
```

許可サイトを指定しても、サーバー自身のページ（`/demo` など）からの接続は常に許可されます。WebSocket のハンドシェイクは同じサイトからでも Origin を送るため、Origin の host がリクエストの Host と一致するものを自分自身とみなします。

## デプロイ (Google Cloud Run)

稼働中の Cloud Run サービス（テナントごとに 1 つ）とビルド基盤は、別リポジトリ `makasete-ai-platform` が管理しています。インフラの定義はそちらにあり、このリポジトリにはありません。

main にマージした変更を手動で反映する場合は、サービスごとにイメージをビルドしてデプロイします。

```bash
# 手元の鍵ファイルなどを送らないよう、main をまっさらに取り出してからビルドする
git worktree add --detach /tmp/makasete-main origin/main
cd /tmp/makasete-main
SHA=$(git rev-parse --short HEAD)
R=asia-northeast1-docker.pkg.dev/[PROJECT_ID]/makasete-ai-repo
SERVICE=makasete-ai-xxxxxxxx   # テナントの Cloud Run サービス名

gcloud builds submit --tag $R/$SERVICE:$SHA --region asia-northeast1 .
gcloud run deploy $SERVICE --image $R/$SERVICE:$SHA --region asia-northeast1
```

`gcloud run deploy` に `--image` だけを渡すと、環境変数やサービスアカウントは現状のまま引き継がれます。イメージのタグは別のイメージ名へ付け替えられないため、サービスごとにビルドしてください。
