import OpenAI from 'openai';
import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';
import { llmTokens } from '../metrics.js';

export class OpenAIProvider implements AIClient {
  readonly provider: LlmProviderId = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(model?: string, baseURL?: string) {
    this.model = model ?? config.openaiModel;
    this.client = new OpenAI({
      apiKey: config.openaiApiKey || 'mock-key',
      baseURL: baseURL,
    });
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);
      
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: request.userPrompt },
        ],
        response_format: { type: 'json_object' },
      });

      // Метрики інкрементуються через AIClient Proxy, тут лишаємо логіку запиту
      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error('Empty response');

      aiRequestCounter.labels(request.task, 'success').inc();
      return parseJsonFromModelText<T>(text);
    } catch (err) {
      aiRequestCounter.labels(request.task, 'error').inc();
      throw err;
    }
  }
}