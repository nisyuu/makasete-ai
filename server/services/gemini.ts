import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
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

    // Define explicit JSON schema for the response
    const schema: Schema = {
        description: "接客応答の構造定義",
        type: SchemaType.OBJECT,
        properties: {
            answer: {
                type: SchemaType.STRING,
                description: "音声合成用の自然な回答テキスト。URLや記号は含めない。",
            },
            display_text: {
                type: SchemaType.STRING,
                description: "画面表示用のMarkdown形式の回答テキスト。商品リンクを含める。",
            },
            recommended_ids: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: "おすすめした商品のIDの配列（最大3つ）",
            },
        },
        required: ["answer", "display_text", "recommended_ids"],
    };


  // Using gemini-2.0-flash for JSON Schema support
  model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
}

/**
 * Generates a structured JSON response from Gemini.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateResponse(prompt: string, history: any[] = []) {
  if (!model) {
    initGemini();
  }

  // Get base prompt from sheet
  const basePrompt =
    getSystemPrompt() ||
    `あなたはECサイトの親切なAI書店員です。名前は福蔵です。`;

  // Construct Product Context
  const products = getProducts();
  const productContext = products
    .slice(0, 500)
    .map(
      (p) =>
        `- (ID: ${p.id}) ${p.title} (${p.category}, ¥${p.price}): ${p.description}`,
    )
    .join("\n");

  const systemInstruction = `
${basePrompt}

以下の商品リストにある情報を元に、お客様へ商品のおすすめや質問への回答を行ってください。

商品リスト:
${productContext}
`;

  try {
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: systemInstruction }],
        },
        {
          role: "model",
          parts: [
            {
              text: "承知いたしました。スプレッドシートから読み込まれた指示に従い、JSON形式で接客を開始します。",
            },
          ],
        },
        ...history,
      ],
    });

    const result = await chat.sendMessage(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
  } catch (e) {
    console.error("Gemini Error:", e);
    throw e;
  }
}
