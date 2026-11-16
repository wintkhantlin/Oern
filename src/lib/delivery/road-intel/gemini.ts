import type { ModelBlock, ModelCaller, ModelMessage } from "./agent.ts";

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: Record<string, unknown> };
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Converts the provider-neutral transcript into Gemini `contents`. */
export function toGeminiContents(messages: ModelMessage[]): GeminiContent[] {
  // Gemini answers a call by function name, so remember each call's name by id.
  const names = new Map<string, string>();
  return messages.map((message) => {
    const role = message.role === "assistant" ? "model" : "user";
    if (typeof message.content === "string")
      return { role, parts: [{ text: message.content }] };
    const parts: GeminiPart[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text) parts.push({ text: block.text });
      } else if (block.type === "tool_use") {
        names.set(block.id, block.name);
        parts.push({
          functionCall: {
            name: block.name,
            args: (block.input as Record<string, unknown>) ?? {},
          },
          ...(block.thoughtSignature
            ? { thoughtSignature: block.thoughtSignature }
            : {}),
        });
      } else {
        const value = parseJson(block.content);
        parts.push({
          functionResponse: {
            name: names.get(block.tool_use_id) ?? "unknown",
            response: block.is_error ? { error: value } : { output: value },
          },
        });
      }
    }
    return { role, parts };
  });
}

/** Calls Google AI Studio (Gemini API, generateContent). Swap it out in tests. */
export function geminiCaller(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}): ModelCaller {
  const doFetch = options.fetch ?? fetch;
  const baseUrl =
    options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  return async (request) => {
    const model = options.model.replace(/^models\//, "");
    const response = await doFetch(
      `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": options.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: toGeminiContents(request.messages),
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
              })),
            },
          ],
          toolConfig: {
            functionCallingConfig: request.forceTool
              ? { mode: "ANY", allowedFunctionNames: [request.forceTool] }
              : { mode: "AUTO" },
          },
          generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
      },
    );
    if (!response.ok)
      throw new Error(`Model request failed (${response.status})`);
    const body = (await response.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
    };
    const blocks: ModelBlock[] = [];
    let calls = 0;
    for (const part of body.candidates?.[0]?.content?.parts ?? []) {
      if (part.functionCall) {
        blocks.push({
          type: "tool_use",
          id: `gemini-call-${calls++}-${part.functionCall.name}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
          ...(part.thoughtSignature
            ? { thoughtSignature: part.thoughtSignature }
            : {}),
        });
      } else if (part.text && !part.thought) {
        blocks.push({ type: "text", text: part.text });
      }
    }
    return { blocks };
  };
}
