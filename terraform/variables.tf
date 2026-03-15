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

variable "bots" {
  type = map(object({
    google_sheets_id = string
    gemini_api_key   = string
    elevenlabs_api_key = string
  }))
  description = "Map of bot configurations. The key will be used as the service name suffix."
}

variable "allowed_origins" {
  type    = string
  default = "*"
}

variable "tts_provider" {
  type    = string
  default = "gemini"
}

variable "github_repository" {
  type        = string
  description = "The GitHub repository in the format owner/name (e.g., nisyuu/makasete-ai)"
}
