/**
 * Utility functions for text processing across the server.
 */

/**
 * Removes all HTML/SSML tags from a string.
 */
export function stripTags(text: string): string {
    return text.replace(/<[^>]*>/g, '');
}

/**
 * Removes standard markdown links [text](url) and keeps only the text.
 */
export function removeMarkdownLinks(text: string): string {
    // 1. Escape '&' as it's a special character in XML/SSML
    let clean = text.replace(/&/g, '&amp;');

    // 2. Standard markdown links [text](url) -> text
    clean = clean.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, '$1');
    
    // 3. Handle cases where there might be a space between ] and ( by mistake
    clean = clean.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\s+\(([^)]+)\)/g, '$1');
    return clean;
}

/**
 * Prepares text for TTS by removing links, emojis, and specific symbols.
 */
export function cleanupForTTS(text: string): string {
    return removeMarkdownLinks(text)
        .replace(/(^|\s)\/[a-zA-Z0-9][-a-zA-Z0-9/._+&@#%=~]*(\b|$)/g, '$1') // Remove relative paths
        .replace(/https?:\/\/\S+/g, '') // Remove URLs
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // Emojis
        .replace(/[＊*#]/g, '') // Markdown symbols
        .replace(/\s+/g, ' ') // Collapse spaces
        .trim();
}

/**
 * Detects if the text is in SSML format (starts with <speak>).
 */
export function isSsml(text: string): boolean {
    return text.trim().startsWith('<speak>');
}

/**
 * Checks if the text contains any HTML/SSML tags.
 */
export function hasTags(text: string): boolean {
    return /<[^>]*>/.test(text);
}
