export class StreamBuffer {
    private buffer: string = "";
    private readonly punctuations = ["。", "！", "？", "\n"]; // Removed "、" for better flow

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
                if (sentence) {
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
