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

# IAM: Grant access to Cloud Run Service Account (Optional: if needed for other services)
data "google_project" "project" {}

resource "google_cloud_run_service" "makasete_servers" {
  for_each = var.makasete_servers
  name     = "makasete-ai-${each.key}"
  location = var.region

  template {
    spec {
      containers {
        image = var.container_image
        
        env {
          name  = "GOOGLE_SHEETS_ID"
          value = each.value.google_sheets_id
        }
        env {
          name  = "GEMINI_API_KEY"
          value = each.value.gemini_api_key
        }
        env {
          name  = "ELEVENLABS_API_KEY"
          value = each.value.elevenlabs_api_key
        }
        env {
          name  = "ALLOWED_ORIGINS"
          value = var.allowed_origins
        }
        env {
          name  = "TTS_PROVIDER"
          value = var.tts_provider
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
data "google_iam_policy" "noauth" {
  binding {
    role = "roles/run.invoker"
    members = [
      "allUsers",
    ]
  }
}

resource "google_cloud_run_service_iam_policy" "noauth" {
  for_each = var.makasete_servers
  location = google_cloud_run_service.makasete_servers[each.key].location
  project  = google_cloud_run_service.makasete_servers[each.key].project
  service  = google_cloud_run_service.makasete_servers[each.key].name

  policy_data = data.google_iam_policy.noauth.policy_data
}

output "urls" {
  value = { for k, v in google_cloud_run_service.makasete_servers : k => v.status[0].url }
}
