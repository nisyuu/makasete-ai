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

/** 整数の環境変数を範囲つきで読む。不正な値は既定値に落として警告する。 */
export function resolveIntEnv(
    name: string,
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
): number {
    if (value === undefined || value.trim() === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        console.warn(
            `[config] Invalid ${name} "${value}". Falling back to ${fallback} ` +
            `(expected an integer between ${min} and ${max}).`,
        );
        return fallback;
    }
    return parsed;
}

function resolveBoolEnv(value: string | undefined): boolean {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
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

    /**
     * 信頼するリバースプロキシの段数。
     *
     * X-Forwarded-For の右から何番目をクライアントの IP として扱うかを決める。
     * Cloud Run に直接つなぐ構成なら 1。Firebase App Hosting や外部ロード
     * バランサを前段に置くと XFF が「client, LB」の形になり、1 のままでは
     * LB の IP を全利用者のキーにしてしまう。その場合は 2 にする。
     * 実際の値は LOG_PROXY_HEADERS=true で本番のヘッダを確認して決める。
     */
    trustedProxyCount: resolveIntEnv(
        'TRUSTED_PROXY_COUNT',
        process.env.TRUSTED_PROXY_COUNT,
        1,
        1,
        10,
    ),

    /**
     * 同一クライアントからの同時接続数の上限。
     *
     * プロキシ段数の設定を誤ると全利用者が 1 つのキーにまとめられるため、
     * ここを小さくしすぎると「6 人目以降が接続できない」形でサイト全体が
     * 止まる。費用の歯止めは下の同時生成数で行い、ここは緩めにする。
     */
    maxConnectionsPerClient: resolveIntEnv(
        'MAX_CONNECTIONS_PER_CLIENT',
        process.env.MAX_CONNECTIONS_PER_CLIENT,
        20,
        1,
        1000,
    ),

    /**
     * プロセス全体で同時に走らせる応答生成の上限。
     *
     * IP 単位の制限がどう転んでも、LLM と TTS の同時呼び出し数はここで
     * 頭打ちになる。クライアントの識別に頼らない歯止めとして置く。
     */
    maxConcurrentGenerations: resolveIntEnv(
        'MAX_CONCURRENT_GENERATIONS',
        process.env.MAX_CONCURRENT_GENERATIONS,
        8,
        1,
        1000,
    ),

    /**
     * プロキシ関連のヘッダを起動後しばらくログに出す。
     *
     * 本番の X-Forwarded-For の形を確認して trustedProxyCount を決めるための
     * 一時的なスイッチ。既定は無効。
     */
    logProxyHeaders: resolveBoolEnv(process.env.LOG_PROXY_HEADERS),
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
