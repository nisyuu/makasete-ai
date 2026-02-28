import { TTSService } from './types';
import { ElevenLabsTTSService } from './elevenlabs';
import { GeminiTTSService } from './google';

export function getTTSService(): TTSService {
    const provider = process.env.TTS_PROVIDER || 'gemini'; // Default to gemini as requested
    
    if (provider === 'elevenlabs') {
        return new ElevenLabsTTSService();
    }
    
    return new GeminiTTSService();
}
