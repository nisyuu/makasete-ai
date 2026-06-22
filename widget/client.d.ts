declare module '*?inline' {
    const content: string
    export default content
}

interface ImportMetaEnv {
    readonly VITE_SERVER_URL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

// TypeScript 6.0 added SpeechRecognitionEvent to its DOM lib but not
// the SpeechRecognition constructor or window properties. Declare them here
// since @types/dom-speech-recognition no longer provides them for TS 6.0+.
interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null;
    onend: ((this: SpeechRecognition, ev: Event) => unknown) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

declare var SpeechRecognition: {
    prototype: SpeechRecognition;
    new(): SpeechRecognition;
};

interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
}
