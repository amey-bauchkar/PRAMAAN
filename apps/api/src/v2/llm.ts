/** One small text-in, text-out client over the configured providers (Gemini, Groq, Anthropic), with failover. */
export interface LlmClient {
  name: string;
  /** Returns the model's text, or null when the provider fails, times out or returns nothing. */
  complete(system: string, user: string, opts?: { json?: boolean; maxTokens?: number }): Promise<string | null>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
type Opts = { json?: boolean; maxTokens?: number };

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown): Promise<any | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const text = (t: unknown) => (typeof t === 'string' && t.trim() ? t : null);

export class GeminiClient implements LlmClient {
  readonly name: string;
  constructor(private key: string, private model = 'gemini-3.5-flash-lite', private f: FetchLike = fetch as unknown as FetchLike) { this.name = `llm:${model}`; }
  async complete(system: string, user: string, o: Opts = {}) {
    const d = await post(this.f, `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, { 'x-goog-api-key': this.key }, {
      systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: o.maxTokens ?? 1500, ...(o.json ? { responseMimeType: 'application/json' } : {}) },
    });
    return text(d?.candidates?.[0]?.content?.parts?.[0]?.text);
  }
}

export class GroqClient implements LlmClient {
  readonly name: string;
  constructor(private key: string, private model = 'openai/gpt-oss-120b', private f: FetchLike = fetch as unknown as FetchLike) { this.name = `llm:groq:${model}`; }
  async complete(system: string, user: string, o: Opts = {}) {
    const d = await post(this.f, 'https://api.groq.com/openai/v1/chat/completions', { authorization: `Bearer ${this.key}` }, {
      model: this.model, temperature: 0, max_tokens: o.maxTokens ?? 1500, ...(o.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    return text(d?.choices?.[0]?.message?.content);
  }
}

export class AnthropicClient implements LlmClient {
  readonly name: string;
  constructor(private key: string, private model = 'claude-haiku-5-5', private f: FetchLike = fetch as unknown as FetchLike) { this.name = `llm:${model}`; }
  async complete(system: string, user: string, o: Opts = {}) {
    const d = await post(this.f, 'https://api.anthropic.com/v1/messages', { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' }, {
      model: this.model, max_tokens: o.maxTokens ?? 1500, temperature: 0, system, messages: [{ role: 'user', content: user }],
    });
    return text(d?.content?.[0]?.text);
  }
}

/** Tries each client in order and returns the first answer. `lastUsed` names the client that really answered. */
export class FailoverLlm implements LlmClient {
  lastUsed: string | null = null;
  constructor(private clients: LlmClient[]) {}
  get name() { return this.clients.map(c => c.name).join(' > '); }
  async complete(system: string, user: string, o?: Opts) {
    for (const c of this.clients) {
      const t = await c.complete(system, user, o);
      if (t) { this.lastUsed = c.name; return t; }
    }
    this.lastUsed = null;
    return null;
  }
}

export function createLlmFromEnv(env: NodeJS.ProcessEnv = process.env): FailoverLlm | null {
  const c: LlmClient[] = [];
  if (env.GROQ_API_KEY) c.push(new GroqClient(env.GROQ_API_KEY, env.GROQ_MODEL || undefined));
  if (env.GEMINI_API_KEY) c.push(new GeminiClient(env.GEMINI_API_KEY, env.GEMINI_MODEL || undefined));
  if (env.ANTHROPIC_API_KEY) c.push(new AnthropicClient(env.ANTHROPIC_API_KEY, env.INTERVIEW_MODEL || undefined));
  return c.length ? new FailoverLlm(c) : null;
}

/** Extracts the first JSON object from model text. */
export function parseJsonObject(t: string | null): any | null {
  const m = t?.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
