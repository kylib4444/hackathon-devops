import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';

export class OpenAiProvider implements AIClient {
  readonly provider: LlmProviderId = 'openai';
  readonly model: string;
  private readonly baseURL: string;

  constructor(model?: string, baseURL?: string) {
    this.model = model ?? config.openaiModel;
    const gateway = process.env.GATEWAY_URL;
    // Дефолтний роут на шлюз, якщо GATEWAY_URL не передано в ENV
    this.baseURL = (gateway || baseURL || 'http://agentgateway-external.agentgateway-system.svc.cluster.local').replace(/\/v1$/, '');
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);
      
      const url = `${this.baseURL}/v1/chat/completions`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // ВИДАЛЕНО: 'Authorization': `Bearer ${config.openaiApiKey}`
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
      const text = data.choices[0]?.message?.content;
      if (!text) throw new Error('Empty response from Gateway');

      aiRequestCounter.labels(request.task, 'success').inc();
      return parseJsonFromModelText<T>(text);
    } catch (err) {
      aiRequestCounter.labels(request.task, 'error').inc();
      throw err;
    }
  }
}