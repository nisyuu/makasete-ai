variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "asia-northeast1"
}

variable "service_name" {
  description = "Cloud Run Service Name"
  type        = string
  default     = "ec-voice-bot"
}

variable "container_image" {
  description = "Container Image URL"
  type        = string
}

variable "google_sheets_id" {
  type = string
}

variable "gemini_api_key" {
  type = string
}

variable "elevenlabs_api_key" {
  type = string
}
