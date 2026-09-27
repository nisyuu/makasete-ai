import { config } from '../../config';
import { TTSService } from './types';
import { ElevenLabsTTSService } from './elevenlabs';
import { GeminiTTSService } from './google';
import { GeminiFlashTTSService } from './geminiFlash';

let cachedService: TTSService | null = null;

export function getTTSService(): TTSService {
    if (cachedService) return cachedService;

    const provider = config.ttsProvider;
    
    if (provider === 'elevenlabs') {
        cachedService = new ElevenLabsTTSService();
    } else if (provider === 'gemini') {
        cachedService = new GeminiTTSService();
    } else {
        cachedService = new GeminiFlashTTSService();
    }
    
    return cachedService;
}
