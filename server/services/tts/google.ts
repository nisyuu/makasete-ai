import { google, texttospeech_v1 } from 'googleapis';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { TTSService } from './types';

export class GeminiTTSService implements TTSService {
    private client: texttospeech_v1.Texttospeech | null = null;

    public getName(): string {
        return "gemini-tts";
    }

    private async getClient(): Promise<texttospeech_v1.Texttospeech> {
        if (this.client) return this.client;

        const localKeyName = 'google-key.json';
        const absoluteKeyPath = path.join(process.cwd(), localKeyName);
        const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
        
        let keyFile: string | undefined = undefined;
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        } else if (fs.existsSync(absoluteKeyPath)) {
            keyFile = absoluteKeyPath;
        } else if (!process.env.K_SERVICE) {
            console.warn("[GeminiTTS] No authentication found. Please provide google-key.json or set GOOGLE_APPLICATION_CREDENTIALS.");
        }

        const auth = new google.auth.GoogleAuth({
            scopes,
            keyFile,
        });

        this.client = google.texttospeech({ version: 'v1', auth });
        return this.client;
    }

    public async generateSpeechStream(text: string): Promise<Readable> {
        const client = await this.getClient();

        try {
            console.log(`[GeminiTTS] Converting text: "${text.substring(0, 20)}..."`);
            const [response] = await new Promise<[texttospeech_v1.Schema$SynthesizeSpeechResponse]>((resolve, reject) => {
                client.text.synthesize({
                    requestBody: {
                        input: { text },
                        voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' }, // Natural Japanese voice
                        audioConfig: { audioEncoding: 'MP3' },
                    }
                }, (err, res) => {
                    if (err) reject(err);
                    else resolve([res!.data]);
                });
            });

            if (!response.audioContent) {
                throw new Error("No audio content received from Google TTS");
            }

            // Google TTS returns base64 encoded string or Buffer
            const buffer = Buffer.from(response.audioContent as string, 'base64');
            return Readable.from(buffer);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Gemini TTS API Error:', message);
            throw error;
        }
    }
}
