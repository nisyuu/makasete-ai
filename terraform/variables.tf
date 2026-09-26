variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "asia-northeast1"
}

variable "container_image" {
  description = "Container Image URL"
  type        = string
}

variable "makasete_servers" {
  type = map(object({
    google_sheets_id = string
  }))
  description = <<-EOT
    Map of Makasete-server configurations. The key will be used as the service name suffix.

    API キーはここに書かない。Terraform に値を渡すと state に平文で保存されるため、
    Secret Manager に gcloud で直接登録する（リポジトリ直下の README.md「デプロイ」を参照）。
    古い tfvars に gemini_api_key などが残っていても型変換で黙って捨てられ、
    state には入らない。ただしファイル自体には平文で残るので削除すること。
  EOT
}

variable "allowed_origins" {
  type        = string
  description = "Comma-separated list of origins allowed to embed the widget. Leave as \"*\" only for development: with \"*\" any third-party site can connect and consume the LLM/TTS budget."
  default     = "*"
}

variable "tts_provider" {
  type    = string
  default = "gemini"
}

variable "github_repository" {
  type        = string
  description = "The GitHub repository in the format owner/name (e.g., nisyuu/makasete-ai)"
}

variable "cloudbuild_webhook_secret_version" {
  type        = string
  description = <<-EOT
    Webhook の認証シークレットのバージョン。値そのものは Terraform では扱わず、
    gcloud secrets versions add で登録する（リポジトリ直下の README.md「デプロイ」を参照）。
    "latest" のままにすると、鍵を入れ替えてもトリガーの再適用が不要になる。
  EOT
  default     = "latest"
}
