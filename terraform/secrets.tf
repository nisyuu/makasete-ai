# Security: API キーを Terraform の管理下に置かない。
#
# Cloud Run の平文 env に置くと run.viewer 権限で読める。かといって
# google_secret_manager_secret_version で値を渡すと、secret_data が
# Terraform の state に平文で保存される（plan 出力で伏せられても state には残る）。
#
# そこで Terraform ではシークレットの「箱」と読み取り権限だけを作り、値
# （バージョン）は gcloud で直接登録する。手順は リポジトリ直下の README.md「デプロイ」を参照。
# これにより API キーは tfvars にも state にも一切現れない。

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

locals {
  # 各サーバーに必要なシークレットの一覧。ElevenLabs の鍵は TTS に
  # ElevenLabs を使う場合だけ作る。
  secret_fields = concat(
    ["gemini-api-key"],
    var.tts_provider == "elevenlabs" ? ["elevenlabs-api-key"] : [],
  )

  server_secrets = merge([
    for name in keys(var.makasete_servers) : {
      for field in local.secret_fields :
      "${name}-${field}" => {
        server = name
        field  = field
      }
    }
  ]...)
}

resource "google_secret_manager_secret" "server_secrets" {
  for_each  = local.server_secrets
  secret_id = "makasete-ai-${each.key}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

# 実行サービスアカウントに、この Secret だけへの読み取り権限を与える
# （プロジェクト全体の secretAccessor は付与しない）。
resource "google_secret_manager_secret_iam_member" "server_secret_accessor" {
  for_each  = google_secret_manager_secret.server_secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.makasete_server_sa.email}"
}

output "secret_ids" {
  description = "API キーを登録する Secret の ID。gcloud secrets versions add で値を追加する。"
  value       = { for k, s in google_secret_manager_secret.server_secrets : k => s.secret_id }
}
