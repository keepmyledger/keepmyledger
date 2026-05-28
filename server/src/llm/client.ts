/**
 * Shared LLM client. OpenAI-compatible (works with OpenAI, Anthropic via their
 * OpenAI-compatible endpoint, Ollama, vLLM, etc.).
 *
 * Configure via env vars:
 *   LLM_API_KEY:    required
 *   LLM_BASE_URL:   defaults to OpenAI
 *   LLM_MODEL:      defaults to "gpt-4o-mini"
 */
import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getLlmClient(): OpenAI {
  if (!process.env.LLM_API_KEY) {
    throw new Error(
      'LLM_API_KEY environment variable is not set. ' +
        'Set LLM_API_KEY (and optionally LLM_BASE_URL and LLM_MODEL).',
    );
  }
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL, // undefined = OpenAI default
    });
  }
  return client;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY);
}

export function getLlmModel(): string {
  return process.env.LLM_MODEL ?? 'gpt-4o-mini';
}

/** True when LLM_BASE_URL points at an Anthropic endpoint (no json_object support). */
export function isAnthropicEndpoint(): boolean {
  return (process.env.LLM_BASE_URL ?? '').includes('anthropic');
}

/** Extract JSON from a potentially-fenced or noisy LLM response. */
export function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return content.slice(start, end + 1);
  return content;
}

interface ChatJsonOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Send a chat-completion request expecting a JSON object reply. Parses the
 * response and returns the unmarshalled object. Throws on missing API key or
 * unparseable JSON.
 */
export async function chatJson<T>(opts: ChatJsonOptions): Promise<T> {
  const c = getLlmClient();
  const response = await c.chat.completions.create({
    model: getLlmModel(),
    messages: [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: opts.userPrompt },
    ],
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 1024,
    ...(isAnthropicEndpoint() ? {} : { response_format: { type: 'json_object' as const } }),
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(extractJson(content)) as T;
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
