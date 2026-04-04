import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config";
import { getInternalSheetData, getSystemPrompt } from "./sheets";

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

/**
 * Generates a text response stream from Gemini.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateResponseStream(prompt: string, history: any[] = []) {
    if (!model) {
        initGemini();
    }

    // Get all data from sheets
    const basePrompt = getSystemPrompt() || `あなたは親切なAIアシスタントです。`;
    const allData = getInternalSheetData();

    const systemInstruction = buildSystemInstruction(basePrompt, allData);

    try {
        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemInstruction }]
                },
                {
                    role: "model",
                    parts: [{ text: "承知いたしました。提供された情報を把握しました。接客を開始します。" }]
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
