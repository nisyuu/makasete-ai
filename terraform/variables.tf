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
    google_sheets_id   = string
    gemini_api_key     = string
    elevenlabs_api_key = optional(string, "")
  }))
  description = <<-EOT
    Map of Makasete-server configurations. The key will be used as the service name suffix.

    API キーは Secret Manager のシークレットとして保管され、Cloud Run には参照だけが
    渡される。secret_data はプロバイダのスキーマ上 sensitive 扱いのため、plan 出力には
    現れない。変数全体に sensitive = true を付けると for_each のキーに使えなくなるため、
    ここでは付けていない。
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
