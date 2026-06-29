import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';

export class OpenAIProvider implements AIClient {
  readonly provider: LlmProviderId = 'openai';
  readonly model: string;
  private readonly baseURL: string;

  constructor(model?: string) {
    this.model = model ?? config.openaiModel;
    
    // ПРИМУСОВИЙ МАРШРУТ: Використовуємо GATEWAY_URL як базовий URL
    // Це змусить клієнт йти в шлюз, а не в api.openai.com
    const gateway = process.env.GATEWAY_URL;
    if (!gateway) {
      console.warn("⚠️ GATEWAY_URL не задано! Запити підуть напряму в OpenAI.");
    }
    this.baseURL = (gateway || 'https://api.openai.com').replace(/\/v1$/, '');
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);
      
      const url = `${this.baseURL}/v1/chat/completions`;

      // Використовуємо fetch, щоб обійти обмеження SDK та мати повний контроль над URL
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Важливо: передаємо ключ. Шлюз повинен його прийняти і авторизуватись далі
          'Authorization': `Bearer ${config.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: request.userPrompt },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Gateway/OpenAI Error ${res.status}: ${errorBody.slice(0, 300)}`);
      }

      const data = await res.json() as any;
      const text = data.choices?.[0]?.message?.content;

      if (!text) throw new Error('Empty response from Gateway');

      aiRequestCounter.labels(request.task, 'success').inc();
      return parseJsonFromModelText<T>(text);
    } catch (err) {
      aiRequestCounter.labels(request.task, 'error').inc();
      throw err;
    }
  }
}