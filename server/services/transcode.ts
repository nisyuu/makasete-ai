import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { Readable, PassThrough } from 'stream';
import fs from 'fs';

// Set ffmpeg path
const systemFfmpeg = '/usr/bin/ffmpeg';
if (fs.existsSync(systemFfmpeg)) {
    ffmpeg.setFfmpegPath(systemFfmpeg);
} else if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
} else {
    console.error("[FFmpeg] No ffmpeg binary found!");
}

/**
 * Transcodes an MP3 stream to fragmented MP4 (AAC) for MSE compatibility.
 */
export function transcodeToFmp4(inputStream: Readable): Readable {
    const outputStream = new PassThrough();

    ffmpeg(inputStream)
        .inputFormat('mp3')
        .audioCodec('aac')
        .format('mp4')
        .outputOptions([
            '-movflags frag_keyframe+empty_moov+default_base_moof+faststart',
            '-avoid_negative_ts make_zero',
            '-b:a 128k',
            '-ar 44100',
            '-ac 2'
        ])
        .on('error', (err) => {
            console.error('[FFmpeg] Error:', err.message);
        })
        .pipe(outputStream, { end: true });

    return outputStream;
}
