# Makasete AI - AI Agents Common Standards

This document defines the shared rules and standards for all AI agents interacting with this repository. These instructions take absolute precedence over general workflows.

## 核心的な原則 (Core Principles)

1.  **Source of Truth**: AIの挙動（プロンプト、知識、設定）は Google Sheets が唯一の真実です。コード内に直接プロンプトやデータをハードコードせず、必ず `server/services/sheets.ts` を経由して取得・反映される構造を維持してください。
2.  **Zero-Latency Experience**: ユーザー体験において「低遅延」は最優先事項です。音声合成 (TTS) とテキスト生成は必ず句読点ベースのストリーミング形式で実装してください。
3.  **Shadow DOM Isolation**: ウィジェット (`widget/`) は埋め込み先のサイトと干渉しないよう、必ず Shadow DOM によるカプセル化を徹底してください。

## 技術スタック (Tech Stack)

-   **Runtime**: Node.js v24 (LTS)
-   **Package Manager**: `pnpm` (v10+) - `npm` や `yarn` は使用禁止。
-   **Main LLM**: Google Gemini API (`gemini-3.8-flash`) - 実装は `server/services/gemini.ts` を参照。
-   **Development Agent**: Claude Code Action (`@claude` メンション・`/review` コメント) - 設定は `.github/workflows/claude.yml` と `claude-code-review.yml`。
-   **Frontend**: Vanilla TypeScript + Vite (No Heavy Frameworks like React/Vue in the widget itself)
-   **Backend**: Express + Socket.io
-   **TTS**: Google Cloud Text-to-Speech（既定）、Gemini 3.8 Flash Lite TTS（`gemini-flash-tts`、PCM をストリーミング）、または ElevenLabs - `TTS_PROVIDER` で切り替え。実装は `server/services/tts/` を参照。

## コーディング規約 (Coding Standards)

-   **TypeScript**: 型安全性を最優先し、`any` の使用を原則禁止します。既存の `// eslint-disable-next-line @typescript-eslint/no-explicit-any` は段階的に解消してください。
-   **Scripts**: TypeScript スクリプトの実行には必ず `pnpm tsx` を使用してください。
-   **Environment**: 環境変数は `server/config.ts` で一括管理し、バリデーションを行ってください。
-   **Testing**: `vitest` を使用してユニットテストを記述してください。特に `server/utils` や `server/services` のロジック変更時は必須です。

## 開発コマンド (Development Commands)

```bash
# サーバーとウィジェットの同時起動
pnpm dev

# 型チェック
pnpm typecheck

# リンター
pnpm lint

# テスト
pnpm test

# 任意のTypeScriptスクリプトを実行
pnpm tsx path/to/script.ts
```

## 自律型エージェントへの指示 (Directives for Agents)

-   **Refactoring**: 既存の `ChatWidget` クラスをリファクタリングする際は、DOM操作を直接行う現在のスタイルを尊重しつつ、モジュール化を進めてください。JSX/TSX の導入は慎重に検討し、依存関係の最小化を優先してください。
-   **Deployment**: インフラ（Cloud Run・Cloud Build・Secret Manager）は別リポジトリ `makasete-ai-platform` で管理しています。このリポジトリに Terraform を戻さないでください。GitHub Actions (`.github/workflows/`) の変更を行う際は、セキュリティ（Secret Manager の利用など）に最大限配慮してください。
-   **Workflows**: `.github/workflows/` ディレクトリ内のファイルは変更しないでください。
