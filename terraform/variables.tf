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
  description = <<-EOT
    ウィジェットの埋め込みを許可するサイトの origin をカンマ区切りで指定する。
    既定値は置かない。未設定のまま apply できると、任意の第三者サイトが接続して LLM と TTS の利用料を消費できる状態で本番が動いてしまう。
  EOT

  validation {
    condition     = !contains(split(",", replace(var.allowed_origins, " ", "")), "*")
    error_message = "allowed_origins に \"*\" は指定できません。埋め込み先の origin を明示してください。"
  }

  validation {
    condition     = length(trimspace(var.allowed_origins)) > 0
    error_message = "allowed_origins を指定してください（例: https://your-shop.example）。"
  }
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

variable "trusted_proxy_count" {
  type        = number
  description = <<-EOT
    このサーバーの前段にあるリバースプロキシの段数。X-Forwarded-For の右から
    何番目をクライアントの IP として扱うかを決める。Cloud Run に直接つなぐなら 1、
    前段に Firebase App Hosting や外部ロードバランサ、CDN があれば 2。
    実際の構成と合っていないと、全利用者が 1 つのレート制限キーにまとめられ、
    同時接続や送信回数の枠をサイト全体で共有してしまう。
    決め方はリポジトリ直下の README.md「プロキシ段数の確認」を参照。
  EOT
  default     = 1

  validation {
    condition     = var.trusted_proxy_count >= 1 && var.trusted_proxy_count <= 10
    error_message = "trusted_proxy_count は 1 以上 10 以下で指定してください。"
  }
}

variable "log_proxy_headers" {
  type        = bool
  description = <<-EOT
    起動後しばらく X-Forwarded-For の形をログに出す。trusted_proxy_count の値を
    確認するための一時的なスイッチで、確認後は false に戻す。
  EOT
  default     = false
}
