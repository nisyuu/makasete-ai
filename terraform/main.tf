provider "google" {
  project = var.project_id
  region  = var.region
}

# Enabled manually by user
# resource "google_project_service" "secretmanager" {
#   service = "secretmanager.googleapis.com"
#   disable_on_destroy = false
# }

# Secrets Definition
resource "google_secret_manager_secret" "google_sheets_id" {
  secret_id = "google_sheets_id"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini_api_key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "elevenlabs_api_key" {
  secret_id = "elevenlabs_api_key"
  replication {
    auto {}
  }
}

# Secret Versions (Store the values)
resource "google_secret_manager_secret_version" "google_sheets_id" {
  secret      = google_secret_manager_secret.google_sheets_id.id
  secret_data = var.google_sheets_id
}

resource "google_secret_manager_secret_version" "gemini_api_key" {
  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

resource "google_secret_manager_secret_version" "elevenlabs_api_key" {
  secret      = google_secret_manager_secret.elevenlabs_api_key.id
  secret_data = var.elevenlabs_api_key
}

# IAM: Grant access to Cloud Run Service Account
# Using the default compute service account for simplicity as Cloud Run uses it by default
data "google_project" "project" {}

resource "google_secret_manager_secret_iam_member" "sheets_reader" {
  secret_id = google_secret_manager_secret.google_sheets_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_secret_manager_secret_iam_member" "gemini_reader" {
  secret_id = google_secret_manager_secret.gemini_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_secret_manager_secret_iam_member" "elevenlabs_reader" {
  secret_id = google_secret_manager_secret.elevenlabs_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_cloud_run_service" "default" {
  name     = var.service_name
  location = var.region

  template {
    spec {
      containers {
        image = var.container_image
        
        env {
          name = "GOOGLE_SHEETS_ID"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.google_sheets_id.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "GEMINI_API_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.gemini_api_key.secret_id
              key  = "latest"
            }
          }
        }
        env {
          name = "ELEVENLABS_API_KEY"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.elevenlabs_api_key.secret_id
              key  = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

# Allow unauthenticated access
data "google_iam_policy" "noauth" {
  binding {
    role = "roles/run.invoker"
    members = [
      "allUsers",
    ]
  }
}

resource "google_cloud_run_service_iam_policy" "noauth" {
  location = google_cloud_run_service.default.location
  project  = google_cloud_run_service.default.project
  service  = google_cloud_run_service.default.name

  policy_data = data.google_iam_policy.noauth.policy_data
}

output "url" {
  value = google_cloud_run_service.default.status[0].url
}
