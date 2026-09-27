import { GoogleGenerativeAI, type Content, type GenerationConfig, type GenerativeModel } from "@google/generative-ai";
import { config } from "../config";
import { getSystemPrompt, SheetData } from "./sheets";
import { resolveLanguage } from "../utils/language";

let genAI: GoogleGenerativeAI;
let model: GenerativeModel | undefined;

// @google/generative-ai 0.24 の型には thinkingConfig が無いが、generationConfig はそのまま API に渡される。
// 3.8 Flash は既定だと思考に時間を使い、最初のトークンが 3.5 Flash より遅くなる。
// 低遅延を優先して思考を "low" に抑える（"minimal" は 3.8 Flash が受け付けない）。
const generationConfig: GenerationConfig & { thinkingConfig: { thinkingLevel: "low" } } = {
    thinkingConfig: { thinkingLevel: "low" },
};

export function initGemini() {
    if (!config.geminiApiKey) {
        console.error("GEMINI_API_KEY is missing");
        return;
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    // Use the latest Flash model, non-JSON streaming mode
    model = genAI.getGenerativeModel({ model: "gemini-3.8-flash", generationConfig });
}

/**
 * Builds the system instruction string from sheet data.
 */
export function buildSystemInstruction(basePrompt: string, allData: Map<string, SheetData[]>): string {
    let dynamicContext = "";
    
    for (const [sheetName, rows] of allData.entries()) {
        if (rows.length === 0) continue;
        
        dynamicContext += `\n### ${sheetName.toUpperCase()}\n`;
        
        // Limit context size per sheet if needed
        const content = rows.slice(0, config.maxRowsPerSheet).map(row => {
            return Object.entries(row)
                .filter(([, val]) => val !== "")
                .map(([key, val]) => `${key}: ${val}`)
                .join(", ");
        }).join("\n- ");
        
        dynamicContext += `- ${content}\n`;
    }

    return `
${basePrompt}

以下の情報を元に、ユーザーの質問に回答してください。
複数のカテゴリにまたがる質問には、それぞれの情報を組み合わせて回答してください。
${dynamicContext}
`;
}

// Object.create(null) でプロトタイプを持たない辞書にする。
// 通常のオブジェクトリテラルだと `LANGUAGE_PROMPTS["constructor"]` が Object 関数を返し、`?? LANGUAGE_PROMPTS.ja` のフォールバックをすり抜けて関数がそのままプロンプトに混入する。
// resolveLanguage と二重に防御する。
const LANGUAGE_PROMPTS: Record<string, string> = Object.assign(
    Object.create(null),
    {
        en: "Please respond in English.",
        ja: "日本語で回答してください。",
    },
);

/**
 * Gemini の履歴は user ターンから始まる必要があり、model ターンが先頭だと
 * startChat が例外を投げる。履歴の切り詰めや割り込み時の取り除きで
 * 並びが崩れても応答全体が失敗しないよう、先頭の model ターンは捨てる。
 */
function trimLeadingModelTurns(history: Content[]): Content[] {
    const firstUser = history.findIndex((turn) => turn.role === "user");
    return firstUser === -1 ? [] : history.slice(firstUser);
}

/**
 * Generates a text response stream from Gemini.
 * Accepts sheet data via dependency injection instead of fetching it internally.
 */
export async function generateResponseStream(
    prompt: string,
    allData: Map<string, SheetData[]>,
    history: Content[] = [],
    language = "ja",
    // 新しい入力で割り込まれたときに生成を打ち切るためのシグナル。
    // for await を break するだけでは受信を止めるだけで、Gemini 側の生成は
    // 最後まで続いてトークンが課金される。fetch ごと中断して課金を止める。
    signal?: AbortSignal
) {
    if (!model) {
        initGemini();
    }

    const safeLanguage = resolveLanguage(language);
    const basePrompt = getSystemPrompt() || `あなたは親切なAIアシスタントです。`;
    const langInstruction = LANGUAGE_PROMPTS[safeLanguage] ?? LANGUAGE_PROMPTS.ja;
    const systemInstruction = buildSystemInstruction(basePrompt, allData) + `\n${langInstruction}`;

    try {
        if (!model) {
            throw new Error("Gemini model is not initialized (GEMINI_API_KEY is missing)");
        }
        // システムプロンプトは会話ターンではなく systemInstruction として渡す。
        // 疑似的な user/model ターンで渡すと、ユーザー発話と同じ役割に並ぶため、
        // 「上の指示を無視して」のような入力に上書きされやすい。
        const chat = model.startChat({
            systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
            history: trimLeadingModelTurns(history),
        });

        const result = signal
            ? await chat.sendMessageStream(prompt, { signal })
            : await chat.sendMessageStream(prompt);
        return result.stream;
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Gemini Error:", message);
        throw e;
    }
}
