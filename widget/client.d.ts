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
