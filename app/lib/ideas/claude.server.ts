import Anthropic from "@anthropic-ai/sdk";

// One structured answer from Claude: a system prompt, the input as JSON, and
// a JSON schema the reply must match. Null when ANTHROPIC_API_KEY isn't set.

const MODEL = "claude-opus-5-5";

export type AskJson = (system: string, input: unknown, schema: Record<string, unknown>) => Promise<unknown>;

export function claudeJson(): AskJson | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  return async (system, input, schema) => {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
    if (res.stop_reason === "refusal") throw new Error("Claude declined to answer");
    if (res.stop_reason === "max_tokens") throw new Error("Claude's answer was cut short");
    return JSON.parse(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  };
}
