import dotenv from 'dotenv';
dotenv.config();

/** 対応している TTS プロバイダ */
const TTS_PROVIDERS = ['gemini', 'elevenlabs'] as const;
export type TTSProvider = (typeof TTS_PROVIDERS)[number];

function resolveTtsProvider(value: string | undefined): TTSProvider {
    if (!value) return 'gemini';
    if ((TTS_PROVIDERS as readonly string[]).includes(value)) {
        return value as TTSProvider;
    }
    console.warn(
        `[config] Unknown TTS_PROVIDER "${value}". Falling back to "gemini". ` +
        `Supported values: ${TTS_PROVIDERS.join(', ')}.`,
    );
    return 'gemini';
}

function resolvePort(value: string | undefined): number {
    const port = Number(value ?? 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.warn(`[config] Invalid PORT "${value}". Falling back to 8080.`);
        return 8080;
    }
    return port;
}

export const config = {
    port: resolvePort(process.env.PORT),
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: 'AYFJOmHxRJdmf572TQ7R',
    modelId: 'eleven_flash_v2_5',
    ttsProvider: resolveTtsProvider(process.env.TTS_PROVIDER),
    maxRowsPerSheet: 500,
};

/**
 * 起動時に必須の環境変数を検証する。
 *
 * これまで設定漏れは起動時には何も起きず、最初のチャットで
 * 「Internal server error」として初めて表面化していた。原因の切り分けに時間が
 * かかるうえ、壊れたインスタンスに Cloud Run がトラフィックを流してしまう。
 * 不足しているものを起動時にまとめて報告する。
 *
 * @returns 不足している必須変数の名前（すべて揃っていれば空配列）
 */
export function validateConfig(): string[] {
    const missing: string[] = [];

    if (!config.geminiApiKey) missing.push('GEMINI_API_KEY');
    if (!config.googleSheetsId) missing.push('GOOGLE_SHEETS_ID');
    if (config.ttsProvider === 'elevenlabs' && !config.elevenLabsApiKey) {
        missing.push('ELEVENLABS_API_KEY');
    }

    return missing;
}
