import { ElevenLabsClient } from "elevenlabs";
import { config } from '../config';

export async function generateSpeechStream(text: string): Promise<NodeJS.ReadableStream> {
    if (!config.elevenLabsApiKey) {
        throw new Error("ELEVENLABS_API_KEY is missing");
    }

    const client = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
    const voiceId = config.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const modelId = config.modelId || 'eleven_turbo_v2_5';

    try {
        const audioStream = await client.textToSpeech.convertAsStream(voiceId, {
            text,
            model_id: modelId,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
            }
        });

        return audioStream as any as NodeJS.ReadableStream;
    } catch (error) {
        console.error('ElevenLabs API Error:', error);
        throw error;
    }
}
