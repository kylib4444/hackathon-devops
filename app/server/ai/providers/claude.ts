import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';

export class ClaudeProvider implements AIClient {
  readonly provider: LlmProviderId = 'claude';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(model?: string) {
    this.model = model ?? config.claudeModel;

    // Визначаємо baseURL, якщо є Gateway
    const gatewayBaseURL = process.env.GATEWAY_URL 
      ? (process.env.GATEWAY_URL.endsWith('/v1') ? process.env.GATEWAY_URL : `${process.env.GATEWAY_URL}/v1`)
      : undefined;

    this.client = new Anthropic({ 
      apiKey: config.anthropicApiKey || 'no-key-needed-if-gateway-handles-auth',
      baseURL: gatewayBaseURL // Anthropic SDK підтримує це
    });
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    const skills = buildSkillsSystemAppendix(request.task);
    const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: request.userPrompt }],
    });

    // РОЗВ'ЯЗАННЯ ПОМИЛКИ: Знаходимо саме текстовий блок
    const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    const text = textBlock ? textBlock.text : '';

    if (!text) throw new Error('Empty Claude response');
    return parseJsonFromModelText<T>(text);
  }
}