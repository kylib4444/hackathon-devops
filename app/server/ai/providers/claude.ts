import { config } from '../../config.js';
import { schemaInstruction, parseJsonFromModelText } from '../json.js';
import { buildSkillsSystemAppendix } from '../skills/loader.js';
import type { AIClient, LlmProviderId, StructuredGenerateRequest } from '../types.js';
import { aiRequestCounter } from '../../metrics.js';

export class ClaudeProvider implements AIClient {
  readonly provider: LlmProviderId = 'claude';
  readonly model: string;
  private readonly baseURL: string;

  constructor(model?: string, baseURL?: string) {
    this.model = model ?? config.claudeModel;
    const gateway = process.env.GATEWAY_URL;
    this.baseURL = (gateway || baseURL || 'http://agentgateway-external.agentgateway-system.svc.cluster.local');
  }

  async generateStructured<T>(request: StructuredGenerateRequest): Promise<T> {
    aiRequestCounter.labels(request.task, 'started').inc();

    try {
      const skills = buildSkillsSystemAppendix(request.task);
      const system = request.systemPrompt + skills + '\n\n' + schemaInstruction(request.jsonSchema);
      
      const url = `${this.baseURL}/v1/messages`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
          // ВИДАЛЕНО: 'x-api-key': config.claudeApiKey
        },
        body: JSON.stringify({
          model: this.model,
          system: system,
          messages: [
            { role: 'user', content: request.userPrompt },
          ],
          max_tokens: 4096
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Gateway/Claude Error ${res.status}: ${errorBody.slice(0, 300)}`);
      }

      const data = await res.json() as any;
      const text = data.content?.[0]?.text;
      if (!text) throw new Error('Empty response from Gateway');

      aiRequestCounter.labels(request.task, 'success').inc();
      return parseJsonFromModelText<T>(text);
    } catch (err) {
      aiRequestCounter.labels(request.task, 'error').inc();
      throw err;
    }
  }
}