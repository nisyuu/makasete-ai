import { Readable } from 'stream';

export interface TTSService {
    generateSpeechStream(text: string, language?: string): Promise<Readable>;
    getName(): string;
}
