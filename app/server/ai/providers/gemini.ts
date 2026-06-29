import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';

export class GeminiProvider implements AIClient {
  readonly provider: LlmProviderId = 'gemini';
  readonly model: string;
  private readonly baseURL: string;

  // Сигнатура конструктора відновлена для виправлення TS2554
  constructor(model?: string) {
    this.model = model ?? config.geminiModel;
    const gateway = process.env.GATEWAY_URL;
    this.baseURL = (gateway || 'https://generativelanguage.googleapis.com').replace(/\/v1beta$/, '');
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);
      
      const url = `${this.baseURL}/v1beta/models/${this.model}:generateContent`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.geminiApiKey,
        },
        body: JSON.stringify({
          contents: [
            { role: 'user', parts: [{ text: system + '\n\n' + request.userPrompt }] }
          ],
          generationConfig: { responseMimeType: 'application/json' }
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Gateway/Gemini Error ${res.status}: ${errorBody.slice(0, 300)}`);
      }

      const data = await res.json() as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) throw new Error('Empty response from Gateway');

      aiRequestCounter.labels(request.task, 'success').inc();
      return parseJsonFromModelText<T>(text);
    } catch (err) {
      aiRequestCounter.labels(request.task, 'error').inc();
      throw err;
    }
  }
}