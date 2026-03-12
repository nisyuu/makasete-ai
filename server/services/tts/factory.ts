import { config } from '../../config';
import { TTSService } from './types';
import { ElevenLabsTTSService } from './elevenlabs';
import { GeminiTTSService } from './google';

let cachedService: TTSService | null = null;

export function getTTSService(): TTSService {
    if (cachedService) return cachedService;

    const provider = config.ttsProvider;
    
    if (provider === 'elevenlabs') {
        cachedService = new ElevenLabsTTSService();
    } else {
        cachedService = new GeminiTTSService();
    }
    
    return cachedService;
}
