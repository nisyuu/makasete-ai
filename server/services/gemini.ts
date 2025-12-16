import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";
import { getProducts } from "./sheets";

let genAI: GoogleGenerativeAI;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any;

export function initGemini() {
    if (!config.geminiApiKey) {
        console.error("GEMINI_API_KEY is missing");
        return;
    }
    // Using gemini-2.5-flash as it matches the "flash" (fast/low latency) requirement.
    // Spec mentioned "gemini-2.5-flash" but assuming it's a typo for 2.5 or future. 
    // If specific version is needed, it can be changed here.
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateResponseStream(prompt: string, history: any[] = []) {
    if (!model) {
        initGemini();
    }

    // Construct System Prompt with Products
    const products = getProducts();
    const productContext = products.slice(0, 500).map(p =>
        `- (ID: ${p.id}) ${p.title} (${p.category}, ¥${p.price}): ${p.description}`
    ).join("\n");
    // Note: Capped at 100 products for safety to fit in context window if list is huge.

    const systemInstruction = `
あなたはECサイトの親切なAI書店員です。
名前は福蔵です。
以下の商品リストにある情報を元に、商品をおすすめしたり、質問に答えてください。
おすすめする商品は3つまでにしてください。
リストにない情報は「申し訳ありません、その情報についてはわかりかねます」と答えてください。
回答は、音声合成で読み上げられることを想定して、以下の点に注意してください：
1. 長すぎない、自然な話し言葉（です・ます調）を使う。
2. URLそのものの読み上げや、記号的な表現は避ける。
3. 感情を込めたような表現（！など）は適度に使用可。
4. 商品をおすすめする際は、必ず「[商品名](/books/商品ID)」という形式でリンクを作成してください。
   例: 「こちらの[走れメロス](/books/1)はいかがでしょうか？」

商品リスト:
${productContext}
`;

    // Initialize chat with history
    // We prepend the system instructions if not present (or as a separate mechanism if model supports it)
    // Gemini 2.5 supports systemInstruction in model config, but for simplicity/compatibility we can use startChat history or systemInstruction arg if available in SDK.
    // newer SDKs support systemInstruction in getGenerativeModel. Let's try that wrapper or just prepend.
    // Prepending is safer across SDK versions.

    try {
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemInstruction }]
                },
                {
                    role: "model",
                    parts: [{ text: "かしこまりました。商品リストを把握しました。お客様の接客を始めます。" }]
                },
                ...history
            ]
        });

        const result = await chat.sendMessageStream(prompt);
        return result.stream;
    } catch (e) {
        console.error("Gemini Error:", e);
        throw e;
    }
}
