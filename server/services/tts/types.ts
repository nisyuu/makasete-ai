import { Readable } from 'stream';

export interface TTSService {
    generateSpeechStream(text: string): Promise<Readable>;
    getName(): string;
}
