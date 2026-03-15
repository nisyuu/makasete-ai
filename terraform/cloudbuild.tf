# 1. Cloud Build execution service account (User-managed)
resource "google_service_account" "cloudbuild_sa" {
  account_id   = "cloudbuild-deploy-sa"
  display_name = "Cloud Build Deploy Service Account"
}

# 2. Grant permissions to the dedicated service account
resource "google_project_iam_member" "cloudbuild_sa_roles" {
  for_each = toset([
    "roles/run.developer",
    "roles/iam.serviceAccountUser",
    "roles/logging.logWriter",
    "roles/artifactregistry.writer"
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.cloudbuild_sa.email}"
}

# 3. Allow Cloud Build Service Agent to use this service account
resource "google_service_account_iam_member" "cloudbuild_service_agent_user" {
  service_account_id = google_service_account.cloudbuild_sa.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:service-${data.google_project.project.number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
}

# 4. Create a dedicated Cloud Build Trigger for EACH bot
resource "google_cloudbuild_trigger" "bot_deploy" {
  for_each    = var.bots
  name        = "makasete-ai-deploy-${each.key}"
  description = "Manual build trigger for ${each.key} (Invoked via GAS)"
  location    = "global"

  github {
    owner = split("/", var.github_repository)[0]
    name  = split("/", var.github_repository)[1]
    push {
      branch = "manual-trigger-only"
    }
  }

  filename = "cloudbuild.yaml"

  # Pass the specific service name for this bot as a substitution
  substitutions = {
    _SERVICE_NAME = "makasete-ai-${each.key}"
  }

  service_account = google_service_account.cloudbuild_sa.id

  depends_on = [
    google_project_service.cloudbuild,
    google_service_account_iam_member.cloudbuild_service_agent_user
  ]
}

resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

# Output a map of bot names to their trigger IDs
output "cloudbuild_trigger_ids" {
  value       = { for k, v in google_cloudbuild_trigger.bot_deploy : k => v.trigger_id }
  description = "The IDs of the Cloud Build triggers for each bot"
}
