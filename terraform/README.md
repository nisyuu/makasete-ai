# ⚠️ このディレクトリの Terraform は現在使われていません

**`terraform apply` を実行しないでください。** 稼働中の環境を壊すおそれがあります。

## 現状

このディレクトリの定義は、稼働中のどのリソースも管理していません。

| 項目 | 状態 |
| :--- | :--- |
| `terraform.tfstate` | リソース 0 件（空） |
| `terraform.tfvars` の `makasete_servers` | 空（`{}`） |
| 稼働中の Cloud Run サービス | このディレクトリの管理外 |

一方、実際の Cloud Run サービスとビルド基盤は **別リポジトリ `makasete-ai-platform` が管理しています**。

- `makasete-ai-platform/terraform/cloudbuild.tf` が Cloud Build トリガー（`makasete-server-deploy-trigger`）と Artifact Registry、実行用サービスアカウント（`server-runtime-sa`）を定義しています。
- テナントごとの Cloud Run サービスは、そのトリガー内の `gcloud run deploy` で命令的に作成されます。Terraform のリソースではありません。
- platform の管理画面から `triggerMakaseteServerBuild()` が呼ばれてデプロイが走ります。

## apply してはいけない理由

1. **既存リソースと衝突します。** サービスアカウントや Artifact Registry は platform 側が作成済みで、このディレクトリの定義で再作成しようとすると失敗します。
2. **環境変数の設計が実態と違います。** 稼働中のサービスは `GOOGLE_SHEETS_ID` と、既存のシークレット `GEMINI_API_KEY` を参照します。このディレクトリはテナントごとに別のシークレットを作る前提になっています。
3. **サービスアカウントが違います。** 実態は `server-runtime-sa`、この定義は `makasete-ai-sa` です。

## 環境変数を変えたいとき

稼働中のサービスの環境変数は、platform 側のトリガー定義（`terraform/cloudbuild.tf` の `gcloud run deploy --set-env-vars`）が決めています。`--set-env-vars` は既存の環境変数をすべて置き換えるため、そこに書かれていない変数は設定できません。

サーバー側で新しい環境変数（例: `PUBLIC_SHEETS`、`TRUSTED_PROXY_COUNT`）を使いたい場合は、platform 側のトリガー定義に substitution を追加する改修が必要です。このリポジトリだけでは対応できません。

## このディレクトリの扱い

次のどちらかを選ぶ必要があります。判断は未了です。

1. **削除する。** platform 側が唯一の構成管理になります。履歴は git に残ります。
2. **実態に合わせて書き直す。** 稼働中のリソースを import し、platform 側との責任範囲を決めます。

どちらにせよ、現状のまま放置すると「apply すれば本番が再現できる」という誤解を生みます。
