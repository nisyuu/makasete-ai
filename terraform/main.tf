provider "google" {
  project = var.project_id
  region  = var.region
}

# APIs
resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "makasete-ai-repo"
  format        = "DOCKER"
  description   = "Docker repository for Makasete AI"
  depends_on    = [google_project_service.artifactregistry]
}

# 1. Makasete Server execution service account
data "google_project" "project" {}

resource "google_service_account" "makasete_server_sa" {
  account_id   = "makasete-ai-sa"
  display_name = "Makasete AI Default compute service account"
}

resource "google_project_iam_member" "makasete_server_roles" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/artifactregistry.reader"
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.makasete_server_sa.email}"
}

# 2. Cloud Run Service
resource "google_cloud_run_service" "makasete_servers" {
  for_each = var.makasete_servers
  name     = "makasete-ai-${each.key}"
  location = var.region

  # 読み取り権限が揃ってからサービスを更新する。Secret の値（バージョン）は
  # Terraform の外で登録するため、apply 前に登録されている必要がある
  # （リポジトリ直下の README.md「デプロイ」を参照）。
  depends_on = [
    google_secret_manager_secret_iam_member.server_secret_accessor,
  ]

  template {
    spec {
      service_account_name = google_service_account.makasete_server_sa.email
      containers {
        image = var.container_image

        env {
          name  = "GOOGLE_SHEETS_ID"
          value = each.value.google_sheets_id
        }
        # Security: API キーは Secret Manager から参照する。平文の env として
        # 置くと、run.viewer 権限だけで `gcloud run services describe` から
        # 読み取れてしまう。
        env {
          name = "GEMINI_API_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.server_secrets["${each.key}-gemini-api-key"].secret_id
              key  = "latest"
            }
          }
        }
        dynamic "env" {
          for_each = var.tts_provider == "elevenlabs" ? [1] : []
          content {
            name = "ELEVENLABS_API_KEY"
            value_from {
              secret_key_ref {
                name = google_secret_manager_secret.server_secrets["${each.key}-elevenlabs-api-key"].secret_id
                key  = "latest"
              }
            }
          }
        }
        env {
          name  = "ALLOWED_ORIGINS"
          value = var.allowed_origins
        }
        env {
          name  = "TTS_PROVIDER"
          value = var.tts_provider
        }
        # 前段のプロキシ段数。実際の構成と合っていないと全利用者が 1 つの
        # レート制限キーにまとめられる。決め方はリポジトリ直下の README.md
        # 「プロキシ段数の確認」を参照。
        env {
          name  = "TRUSTED_PROXY_COUNT"
          value = tostring(var.trusted_proxy_count)
        }
        env {
          name  = "LOG_PROXY_HEADERS"
          value = tostring(var.log_proxy_headers)
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "1024Mi"
          }
        }
      }
    }
    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale"  = "0"
        "run.googleapis.com/cpu-allocation" = "always"
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].metadata[0].annotations["autoscaling.knative.dev/minScale"],
    ]
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

# Allow unauthenticated access for each service
#
# 以前は google_cloud_run_service_iam_policy を使っていたが、これはサービスの
# IAM ポリシー全体を上書きする（authoritative）。同じサービスに別の
# iam_member（scheduler.tf の Workflow 用 run.developer）を付けると、
# apply のたびに片方が消えて付け直される取り合いになり、消えている間は
# min-instances の変更が 403 で失敗する。追加的な iam_member に統一する。
resource "google_cloud_run_service_iam_member" "noauth" {
  for_each = var.makasete_servers
  location = google_cloud_run_service.makasete_servers[each.key].location
  project  = google_cloud_run_service.makasete_servers[each.key].project
  service  = google_cloud_run_service.makasete_servers[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# 旧リソースは state から外すだけにする。destroy すると、その瞬間に
# サービスの IAM ポリシーが空になり、ウィジェットからアクセスできなくなる。
removed {
  from = google_cloud_run_service_iam_policy.noauth

  lifecycle {
    destroy = false
  }
}

output "urls" {
  value = { for k, v in google_cloud_run_service.makasete_servers : k => v.status[0].url }
}
