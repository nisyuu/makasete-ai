export class StreamBuffer {
    private buffer: string = "";
    private readonly punctuations = ["。", "！", "？", "\n", "…"]; // "…" added as sentence boundary

    public add(text: string): string[] {
        this.buffer += text;
        const sentences: string[] = [];

        while (true) {
            let earliestIndex = -1;
            let foundPunctuation = "";

            for (const p of this.punctuations) {
                const index = this.buffer.indexOf(p);
                if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
                    earliestIndex = index;
                    foundPunctuation = p;
                }
            }

            if (earliestIndex !== -1) {
                const sentence = this.buffer.slice(0, earliestIndex + foundPunctuation.length).trim();
                // Skip punctuation-only segments — they produce no meaningful TTS audio
                if (sentence && sentence.replace(/[\s。！？…\n]/g, "").length > 0) {
                    sentences.push(sentence);
                }
                this.buffer = this.buffer.slice(earliestIndex + foundPunctuation.length);
            } else {
                break;
            }
        }

        return sentences;
    }

    public flush(): string {
        const remaining = this.buffer.trim();
        this.buffer = "";
        return remaining;
    }
}
