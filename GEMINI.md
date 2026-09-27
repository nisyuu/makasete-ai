@AGENTS.md

# Gemini - Specific Instructions

This file extends the common standards defined in `AGENTS.md` with Gemini-specific rules.

## API キー (API Key)

-   Gemini API へのアクセスには環境変数 `GEMINI_API_KEY` を使用してください。
-   API キーはコードにハードコードせず、必ず `server/config.ts` を経由して参照してください。

## TTS 設定 (Text-to-Speech)

-   デフォルトの TTS プロバイダーは Gemini 3.8 Flash Lite TTS (`TTS_PROVIDER=gemini-flash-tts`) です。Google Cloud Text-to-Speech (Chirp 3: HD) を使う場合は `TTS_PROVIDER=gemini` を設定してください。
-   ElevenLabs を使用する場合は `TTS_PROVIDER=elevenlabs` および `ELEVENLABS_API_KEY` を設定してください。
