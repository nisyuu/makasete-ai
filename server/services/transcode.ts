import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { Readable, PassThrough } from 'stream';

// Set ffmpeg path
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
} else {
    console.error("FFmpeg static path not found!");
}

/**
 * Transcodes an MP3 stream to fragmented MP4 (AAC) for MSE compatibility (especially iOS).
 * @param inputStream The input audio stream (MP3)
 * @returns A Readable stream of the transcoded audio (fMP4/AAC)
 */
export function transcodeToFmp4(inputStream: Readable): Readable {
    const outputStream = new PassThrough();

    ffmpeg(inputStream)
        .inputFormat('mp3')
        .audioCodec('aac')
        .format('mp4')
        // Important flags for MSE:
        // frag_keyframe: Fragment at keyframes
        // empty_moov: Write an empty moov atom at the beginning (required for streaming)
        // default_base_moof: Improve compatibility
        .outputOptions([
            '-movflags frag_keyframe+empty_moov+default_base_moof',
            '-b:a 128k' // Bitrate 128k
        ])
        .on('error', (err) => {
            console.error('FFmpeg error:', err);
            // outputStream.emit('error', err); // Do not crash the pipe, just log
        })
        .pipe(outputStream, { end: true });

    return outputStream;
}
