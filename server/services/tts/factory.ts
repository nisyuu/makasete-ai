import { config } from '../../config';
import { TTSService } from './types';
import { ElevenLabsTTSService } from './elevenlabs';
import { GeminiTTSService } from './google';

export function getTTSService(): TTSService {
    const provider = config.ttsProvider;
    
    if (provider === 'elevenlabs') {
        return new ElevenLabsTTSService();
    }
    
    return new GeminiTTSService();
}
