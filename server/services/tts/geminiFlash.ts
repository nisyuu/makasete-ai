import { GoogleGenerativeAI, type GenerationConfig, type GenerativeModel } from "@google/generative-ai";
import { Readable } from "stream";
import { config } from "../../config";
import { TTSService } from "./types";

// @google/generative-ai 0.24 の型には responseModalities と speechConfig が無いが、generationConfig はそのまま API に渡される。
type SpeechGenerationConfig = GenerationConfig & {
    responseModalities: ["AUDIO"];
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
};

/**
 * Gemini API の音声生成モデル（Gemini 3.8 Flash Lite TTS）で読み上げる。
 *
 * ストリーミングで返る音声は 24kHz・16bit・モノラルのヘッダ無し PCM で、断片ごとに単独で再生できる。
 * MP3 のように全体を待たずに、届いた断片から順にウィジェットへ流せるので、最初の音が出るまでが Chirp 3: HD の約半分になる。
 * 言語は入力文から自動で判別されるため、language での声の切り替えはしない。
 */
export class GeminiFlashTTSService implements TTSService {
    static readonly MODEL = "gemini-3.8-flash-lite-tts";
    // 明るく親しみやすい声。Chirp 3: HD で使っていた Aoede と同じ名前の声がある。
    static readonly VOICE = "Aoede";

    readonly pcmSampleRate = 24000;

    private model: GenerativeModel | null = null;

    public getName(): string {
        return "gemini-flash-tts";
    }

    private getModel(): GenerativeModel {
        if (this.model) return this.model;
        if (!config.geminiApiKey) {
            throw new Error("GEMINI_API_KEY is missing");
        }
        const generationConfig: SpeechGenerationConfig = {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GeminiFlashTTSService.VOICE } } },
        };
        this.model = new GoogleGenerativeAI(config.geminiApiKey).getGenerativeModel({
            model: GeminiFlashTTSService.MODEL,
            generationConfig,
        });
        return this.model;
    }

    public async generateSpeechStream(text: string, _language = "ja"): Promise<Readable> {
        try {
            const result = await this.getModel().generateContentStream(text);
            // SDK は同じ応答を集約した result.response も作り、ストリームが途中で失敗すると reject する。
            // 使わないまま放置すると未処理の reject になるので握りつぶす。失敗は result.stream 側の 'error' で扱う。
            result.response.catch(() => {});
            return Readable.from(
                (async function* () {
                    for await (const chunk of result.stream) {
                        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
                            if (part.inlineData?.data) {
                                yield Buffer.from(part.inlineData.data, "base64");
                            }
                        }
                    }
                })(),
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Gemini Flash TTS API Error:", message);
            throw error;
        }
    }
}
