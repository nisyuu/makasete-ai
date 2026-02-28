import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";
import { getProducts, getSystemPrompt } from "./sheets";

let genAI: GoogleGenerativeAI;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any;

export function initGemini() {
    if (!config.geminiApiKey) {
        console.error("GEMINI_API_KEY is missing");
        return;
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    // Use gemini-2.5-flash as originally intended, non-JSON streaming mode
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

/**
 * Generates a text response stream from Gemini.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateResponseStream(prompt: string, history: any[] = []) {
    if (!model) {
        initGemini();
    }

    // Get base prompt from sheet
    const basePrompt = getSystemPrompt() || `あなたはECサイトの親切なAI書店員です。名前は福蔵です。`;

    // Construct Product Context
    const products = getProducts();
    const productContext = products.slice(0, 500).map(p =>
        `- (ID: ${p.id}) ${p.title} (${p.category}, ¥${p.price}): ${p.description}`
    ).join("\n");

    const systemInstruction = `
${basePrompt}

以下の商品リストにある情報を元に、商品をおすすめしたり、質問に答えてください。
おすすめする商品は3つまでにしてください。
リストにない情報は「申し訳ありません、その情報についてはわかりかねます」と答えてください。
回答は、音声合成で読み上げられることを想定して、以下の点に注意してください：
1. 長すぎない、自然な話し言葉（です・ます調）を使う。
2. URLそのものの読み上げや、記号的な表現は避ける。
3. 感情を込めたような表現（！など）は適度に使用可。
4. 商品をおすすめする際は、必ず「[商品名](/books/商品ID)」という形式でリンクを作成してください。

商品リスト:
${productContext}
`;

    try {
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemInstruction }]
                },
                {
                    role: "model",
                    parts: [{ text: "かしこまりました。商品リストを把握しました。接客を開始します。" }]
                },
                ...history
            ]
        });

        const result = await chat.sendMessageStream(prompt);
        return result.stream;
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Gemini Error:", message);
        throw e;
    }
}
