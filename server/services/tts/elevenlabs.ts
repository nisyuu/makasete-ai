import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Readable } from 'stream';
import { config } from '../../config';
import { TTSService } from './types';

export class ElevenLabsTTSService implements TTSService {
    public getName(): string {
        return "elevenlabs";
    }

    public async generateSpeechStream(text: string): Promise<Readable> {
        if (!config.elevenLabsApiKey) {
            throw new Error("ELEVENLABS_API_KEY is missing");
        }

        const client = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
        const voiceId = config.voiceId || 'AYFJOmHxRJdmf572TQ7R';
        const modelId = config.modelId || 'eleven_flash_v2_5';

        try {
            const audioStream = await client.textToSpeech.convert(voiceId, {
                text,
                modelId: modelId,
                outputFormat: "mp3_44100_128",
                voiceSettings: {
                    stability: 0.7,
                    similarityBoost: 1,
                }
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return Readable.from(audioStream as any);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('ElevenLabs API Error:', message);
            throw error;
        }
    }
}
