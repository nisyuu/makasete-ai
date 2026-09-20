# Security: API キーを Cloud Run の平文環境変数として渡さない。
#
# `env { value = ... }` で注入すると、run.viewer 権限があれば
# `gcloud run services describe` で誰でも読み取れてしまう。Secret Manager に
# 保管し、Cloud Run には参照だけを渡す。

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

locals {
  # 各サーバーごとに必要なシークレットを {key => {server, field}} に展開する。
  # ここには鍵の値そのものを入れない。値を locals に持たせると for_each や
  # リソース名に sensitive な値が混ざり、Terraform に拒否される。
  # elevenlabs_api_key は TTS プロバイダによっては未設定のまま運用されるため、
  # 値があるものだけを対象にする。
  server_secrets = merge(
    {
      for name, cfg in var.makasete_servers :
      "${name}-gemini-api-key" => {
        server = name
        field  = "gemini_api_key"
      }
    },
    {
      for name, cfg in var.makasete_servers :
      "${name}-elevenlabs-api-key" => {
        server = name
        field  = "elevenlabs_api_key"
      }
      if cfg.elevenlabs_api_key != ""
    },
  )
}

resource "google_secret_manager_secret" "server_secrets" {
  for_each  = local.server_secrets
  secret_id = "makasete-ai-${each.key}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "server_secrets" {
  for_each = local.server_secrets
  secret   = google_secret_manager_secret.server_secrets[each.key].id
  # secret_data はプロバイダのスキーマで sensitive 指定されているため、
  # plan / apply の出力に平文で現れない。
  secret_data = each.value.field == "gemini_api_key" ? var.makasete_servers[each.value.server].gemini_api_key : var.makasete_servers[each.value.server].elevenlabs_api_key
}

# 実行サービスアカウントに、この Secret だけへの読み取り権限を与える
# （プロジェクト全体の secretAccessor は付与しない）。
resource "google_secret_manager_secret_iam_member" "server_secret_accessor" {
  for_each  = google_secret_manager_secret.server_secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.makasete_server_sa.email}"
}
