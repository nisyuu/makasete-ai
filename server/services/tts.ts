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
        const audioStream = await client.textToSpeech.convert(voiceId, {
            text,
            modelId: modelId,
            outputFormat: "mp3_44100_128",
            voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.75,
            }
        });

        // Check if stream needs conversion (e.g. if it is a Web Stream or just Async Iterable)
        // The SDK might return a Node stream or a standard Web Stream depending on valid types.
        // We use Readable.from() to ensure it is a Node.js Readable stream.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodeStream = Readable.from(audioStream as any);
        return nodeStream;
    } catch (error) {
        console.error('ElevenLabs API Error:', error);
        throw error;
    }
}
