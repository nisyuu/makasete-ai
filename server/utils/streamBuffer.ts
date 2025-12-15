export class StreamBuffer {
    private buffer: string = "";
    private readonly punctuations = ["。", "、", "！", "？", "\n"];

    public add(text: string): string[] {
        this.buffer += text;
        const sentences: string[] = [];

        let lastIndex = 0;
        for (let i = 0; i < this.buffer.length; i++) {
            const char = this.buffer[i];
            if (this.punctuations.includes(char)) {
                const sentence = this.buffer.substring(lastIndex, i + 1).trim();
                if (sentence) {
                    sentences.push(sentence);
                }
                lastIndex = i + 1;
            }
        }

        // Remove processed part from buffer
        this.buffer = this.buffer.substring(lastIndex);

        // Also check if we have a very long buffer without punctuation to avoid memory issues or hanging
        // For now simple implementation as per spec

        return sentences;
    }

    public flush(): string {
        const remaining = this.buffer.trim();
        this.buffer = "";
        return remaining;
    }
}
