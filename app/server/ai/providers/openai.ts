import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';

export class OpenAIProvider implements AIClient {
  readonly provider: LlmProviderId = 'openai';
  readonly model: string;
  private readonly baseURL: string;

  constructor(model?: string, baseURL?: string) {
    this.model = model ?? config.openaiModel;
    
    // СУВОРИЙ МАРШРУТ: Завжди йдемо через Gateway, якщо він є.
    const gateway = process.env.GATEWAY_URL;
    const base = gateway || baseURL || 'https://api.openai.com';
    
    // Відрізаємо /v1 на кінці, якщо він там є, щоб не дублювати
    this.baseURL = base.replace(/\/v1$/, '');
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);
      
      const url = `${this.baseURL}/v1/chat/completions`;

      // Використовуємо чистий fetch замість SDK, щоб уникнути конфліктів зі шлюзом
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: request.userPrompt },
          ],
          // Якщо Gateway все ще буде видавати 400, спробуй закоментувати наступний рядок:
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