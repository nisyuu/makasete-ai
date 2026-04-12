import dotenv from 'dotenv';
dotenv.config();

export const SUPPORTED_LOCALES = ['ja', 'en', 'zh-CN'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: Locale = (process.env.APP_LOCALE as Locale | undefined) !== undefined &&
    SUPPORTED_LOCALES.includes(process.env.APP_LOCALE as Locale)
    ? (process.env.APP_LOCALE as Locale)
    : 'ja';

export const config = {
    port: process.env.PORT || 8080,
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: 'AYFJOmHxRJdmf572TQ7R',
    modelId: 'eleven_flash_v2_5',
    ttsProvider: process.env.TTS_PROVIDER || 'gemini',
    maxRowsPerSheet: 500,
    defaultLocale: DEFAULT_LOCALE,
};
