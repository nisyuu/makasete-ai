import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: process.env.PORT || 8080,
    googleSheetsId: process.env.GOOGLE_SHEETS_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: 'AYFJOmHxRJdmf572TQ7R',
    modelId: 'eleven_flash_v2_5',
};
