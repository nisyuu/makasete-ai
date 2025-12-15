import axios from 'axios';
import { config } from '../config';

export async function generateSpeechStream(text: string): Promise<NodeJS.ReadableStream> {
    if (!config.elevenLabsApiKey) {
        throw new Error("ELEVENLABS_API_KEY is missing");
    }

    const voiceId = config.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const modelId = config.modelId || 'eleven_turbo_v2_5';

    try {
        const response = await axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
            headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': config.elevenLabsApiKey,
                'Content-Type': 'application/json',
            },
            data: {
                text,
                model_id: modelId,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                }
            },
            responseType: 'stream'
        });

        return response.data;
    } catch (error) {
        console.error('ElevenLabs API Error:', error);
        throw error;
    }
}
