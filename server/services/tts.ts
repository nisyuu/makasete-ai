import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Readable } from 'stream';
import { config } from '../config';

export async function generateSpeechStream(text: string): Promise<NodeJS.ReadableStream> {
    if (!config.elevenLabsApiKey) {
        throw new Error("ELEVENLABS_API_KEY is missing");
    }

    const client = new ElevenLabsClient({ apiKey: config.elevenLabsApiKey });
    const voiceId = config.voiceId || 'AYFJOmHxRJdmf572TQ7R';
    const modelId = config.modelId || 'eleven_flash_v2_5';

    try {
        console.log(`[ElevenLabs] Converting text: "${text.substring(0, 20)}..."`);
        const audioStream = await client.textToSpeech.convert(voiceId, {
            text,
            modelId: modelId,
            outputFormat: "mp3_44100_128",
            voiceSettings: {
                stability: 0.7,
                similarityBoost: 1,
            }
        });

        // The stream from SDK might be a Web Stream or AsyncIterable. 
        // Readable.from handles AsyncIterables correctly in Node.js.
        return Readable.from(audioStream as any);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('ElevenLabs API Error:', message);
        throw error;
    }
}
