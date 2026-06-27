import OpenAI from 'openai';
import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';

export class OpenAIProvider implements AIClient {
  readonly provider: LlmProviderId = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(model?: string, baseURL?: string) {
    this.model = model ?? config.openaiModel;
    const resolvedBaseURL = baseURL || (process.env.GATEWAY_URL
      ? (process.env.GATEWAY_URL.endsWith('/v1') ? process.env.GATEWAY_URL : `${process.env.GATEWAY_URL}/v1`)
      : undefined);
    this.client = new OpenAI({
      apiKey: config.openaiApiKey || 'mock-key',
      baseURL: resolvedBaseURL,
    });
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    // Вказуємо task з реквесту, щоб бачити розбивку по задачах у Grafana
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system =
        request.systemPrompt +
        skills +
        '\n\n' +
        schemaInstruction(request.jsonSchema);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: request.userPrompt },
        ],
        response_format: request.jsonSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: `${request.task}_response`,
                strict: false,
                schema: request.jsonSchema,
              },
            }
          : { type: 'json_object' },
      }, {
        headers: {
          'x-gateway-task-name': request.task,
        }
      });

      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error('Empty OpenAI response');

      // Успіх!
      aiRequestCounter.labels(request.task, 'success').inc();
      
      return parseJsonFromModelText<T>(text);
    } catch (err) {
      // Помилка!
      aiRequestCounter.labels(request.task, 'error').inc();
      throw err;
    }
  }
}