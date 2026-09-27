import { Readable } from 'stream';

export interface TTSService {
    generateSpeechStream(text: string, language?: string): Promise<Readable>;
    getName(): string;
    /**
     * 16bit・リトルエンディアン・モノラルのヘッダ無し PCM を返すときのサンプルレート。
     * 設定されていれば、ストリームの断片を文の終わりを待たずにそのままクライアントへ送る。
     * 未設定なら MP3 など、文全体で1つのファイルとして扱う形式とみなす。
     */
    readonly pcmSampleRate?: number;
}
