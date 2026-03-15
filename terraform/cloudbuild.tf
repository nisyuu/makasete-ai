# Cloud Build Trigger for Manual Deployment (GAS-triggered) - 1st Gen
resource "google_cloudbuild_trigger" "manual_deploy" {
  name        = "makasete-ai-manual-deploy"
  description = "Manual build trigger for Makasete AI (Invoked via GAS)"
  location    = "global"

  # 1st Gen GitHub App connection
  github {
    owner = split("/", var.github_repository)[0]
    name  = split("/", var.github_repository)[1]
    
    push {
      # Matches nothing, disabling auto-trigger on push
      branch = "^$"
    }
  }

  filename = "cloudbuild.yaml"

  depends_on = [google_project_service.cloudbuild]
}

# IAM: Use the project number based default Cloud Build service account
# Format: [PROJECT_NUMBER]@cloudbuild.gserviceaccount.com

resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudbuild_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

output "cloudbuild_trigger_id" {
  value       = google_cloudbuild_trigger.manual_deploy.trigger_id
  description = "The ID of the manual Cloud Build trigger"
}
