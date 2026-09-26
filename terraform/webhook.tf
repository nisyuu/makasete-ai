# Security: スプレッドシートからのデプロイを、人の OAuth トークンではなく
# Webhook で起動する。
#
# 以前は GAS が `ScriptApp.getOAuthToken()` で「メニューを押した人」のトークンを
# 取り、Cloud Build API を直接呼んでいた。この方式は cloud-platform スコープ
# （GCP 全体の操作）を必要とする。コンテナバインドのスクリプトはシートの編集者が
# 誰でも書き換えられるため、編集者がスクリプトに窃取コードを仕込み、管理者が
# メニューを押した瞬間にそのトークンを奪える。
#
# Webhook トリガーなら、GAS が持つのは「このトリガーを起動する鍵」だけになる。
# 鍵が漏れても、できるのは main のデプロイを走らせることだけ。

# 1. Webhook の認証に使うシークレット（値は Terraform の外で登録する）
#
# 値をここで生成すると state に平文で残るため、箱だけを作る。
# 登録手順はリポジトリ直下の README.md「デプロイ」を参照。
resource "google_secret_manager_secret" "cloudbuild_webhook" {
  secret_id = "makasete-ai-cloudbuild-webhook"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

# Cloud Build のサービスエージェントに、このシークレットだけの読み取りを許可する
resource "google_secret_manager_secret_iam_member" "cloudbuild_webhook_accessor" {
  secret_id = google_secret_manager_secret.cloudbuild_webhook.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

# 2. Makasete サーバーごとの Webhook トリガー
#
# 既存の手動トリガー（cloudbuild.tf）はそのまま残す。切り替えの検証が済むまで
# 既存の経路を壊さないため。検証後に手動トリガー側を削除する。
resource "google_cloudbuild_trigger" "makasete_server_webhook" {
  for_each    = var.makasete_servers
  name        = "makasete-ai-webhook-${each.key}"
  description = "Webhook deploy trigger for ${each.key} (invoked from the spreadsheet)"
  location    = "global"

  webhook_config {
    secret = "${google_secret_manager_secret.cloudbuild_webhook.id}/versions/${var.cloudbuild_webhook_secret_version}"
  }

  # Webhook トリガーはリポジトリのイベントで起動しないため、どこから
  # ソースとビルド設定を取るかを明示する必要がある。
  source_to_build {
    uri       = "https://github.com/${var.github_repository}"
    ref       = "refs/heads/main"
    repo_type = "GITHUB"
  }

  git_file_source {
    path      = "cloudbuild.yaml"
    uri       = "https://github.com/${var.github_repository}"
    revision  = "refs/heads/main"
    repo_type = "GITHUB"
  }

  substitutions = {
    _SERVICE_NAME = "makasete-ai-${each.key}"
  }

  service_account = google_service_account.cloudbuild_sa.id

  depends_on = [
    google_project_service.cloudbuild,
    google_secret_manager_secret_iam_member.cloudbuild_webhook_accessor,
    google_service_account_iam_member.cloudbuild_service_agent_user,
  ]
}

output "cloudbuild_webhook_trigger_ids" {
  description = "スプレッドシートの Script Properties に設定する Webhook トリガーの ID"
  value       = { for k, v in google_cloudbuild_trigger.makasete_server_webhook : k => v.trigger_id }
}
