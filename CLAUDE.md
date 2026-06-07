@AGENTS.md

# Claude Code - Specific Instructions

This file extends the common standards defined in `AGENTS.md` with Claude Code-specific rules.

## モデル指定 (Model)

-   自律型エージェント (`scripts/agent.ts`) では `claude-sonnet-4-6` モデルを使用してください。

## ブランチ運用 (Branch Naming)

-   Issue 対応のブランチ名は `claude/issue-{issue番号}-{YYYYMMDDHHmm}` の形式で作成してください。
-   PR は `develop` ブランチに向けて作成してください。

## 制約事項 (Constraints)

-   `.github/workflows/` ディレクトリ内のファイルは **変更禁止** です。GitHub App の権限上、変更しても反映されません。
-   PR を作成する際は、必ず `closes #Issue番号` を本文に含めてください。
