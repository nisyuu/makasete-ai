# APIs
resource "google_project_service" "workflows" {
  service            = "workflows.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

# 1. Workflow サービスアカウント
resource "google_service_account" "workflow_sa" {
  account_id   = "cloud-run-scaler-sa"
  display_name = "Cloud Run Scaler Workflow Service Account"
}

resource "google_project_iam_member" "workflow_run_admin" {
  project = var.project_id
  role    = "roles/run.developer"
  member    = "serviceAccount:${google_service_account.workflow_sa.email}"
}

resource "google_project_iam_member" "workflow_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member    = "serviceAccount:${google_service_account.workflow_sa.email}"
}

# 2. Workflow
resource "google_workflows_workflow" "scale_workflow" {
  name            = "scale-cloud-run-workflow"
  region          = var.region
  description     = "Updates Cloud Run min-instances"
  service_account = google_service_account.workflow_sa.email
  source_contents = <<EOF
main:
  params: [args]
  steps:
    - init:
        assign:
          - project_id: $${sys.get_env("GOOGLE_CLOUD_PROJECT_ID")}
          - service_name: $${args.service_name}
          - location: $${args.location}
          - min_instances: $${args.min_instances}
    - patch_service:
        call: http.patch
        args:
          url: $${"https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/" + project_id + "/services/" + service_name}
          auth:
            type: OAuth2
          body:
            apiVersion: serving.knative.dev/v1
            kind: Service
            metadata:
              name: $${service_name}
            spec:
              template:
                metadata:
                  annotations:
                    autoscaling.knative.dev/minScale: $${min_instances}
        result: patch_result
    - return_result:
        return: $${patch_result}
EOF
  depends_on      = [google_project_service.workflows]
}

# 3. Scheduler サービスアカウント
resource "google_service_account" "scheduler_sa" {
  account_id   = "workflow-scheduler-sa"
  display_name = "Cloud Scheduler Workflow Invoker SA"
}

resource "google_project_iam_member" "scheduler_workflow_invoker" {
  project = var.project_id
  role    = "roles/workflows.invoker"
  member  = "serviceAccount:${google_service_account.scheduler_sa.email}"
}

# 4. 09:00 START (min=1)
resource "google_cloud_scheduler_job" "start_job" {
  name             = "start-bot-instances"
  description      = "Set min-instances to 1 at 9 AM JST"
  schedule         = "0 9 * * *"
  time_zone        = "Asia/Tokyo"
  region           = var.region

  http_target {
    http_method = "POST"
    uri         = "https://workflowexecutions.googleapis.com/v1/${google_workflows_workflow.scale_workflow.id}/executions"
    body        = base64encode(jsonencode({
      argument = jsonencode({
        min_instances = "1"
        service_name  = var.service_name
        location      = var.region
      })
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler_sa.email
    }
  }
}

# 5. 21:00 STOP (min=0)
resource "google_cloud_scheduler_job" "stop_job" {
  name             = "stop-bot-instances"
  description      = "Set min-instances to 0 at 9 PM JST"
  schedule         = "0 21 * * *"
  time_zone        = "Asia/Tokyo"
  region           = var.region

  http_target {
    http_method = "POST"
    uri         = "https://workflowexecutions.googleapis.com/v1/${google_workflows_workflow.scale_workflow.id}/executions"
    body        = base64encode(jsonencode({
      argument = jsonencode({
        min_instances = "0"
        service_name  = var.service_name
        location      = var.region
      })
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler_sa.email
    }
  }
}
