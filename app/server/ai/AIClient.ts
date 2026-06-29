import { config } from '../config.js';
import { resolveLlmConfig } from './resolve.js';
import { DemoAIClient } from './providers/demo.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { ClaudeProvider } from './providers/claude.js';
import type { AIClient } from './types.js';
import { logDemoModeWarningIfNeeded } from './demo-notice.js';
import { llmTokens, llmFailovers } from './metrics.js';

export function createAIClient(): AIClient {
  const resolved = resolveLlmConfig();
  if (resolved.demoMode || resolved.provider === 'demo') {
    logDemoModeWarningIfNeeded();
    return new DemoAIClient();
  }

  if (process.env.GATEWAY_URL) {
    const gatewayBaseURL = process.env.GATEWAY_URL.endsWith('/v1')
      ? process.env.GATEWAY_URL
      : `${process.env.GATEWAY_URL}/v1`;
    return new OpenAIProvider(resolved.model, gatewayBaseURL);
  }

  switch (resolved.provider) {
    case 'openai': return new OpenAIProvider(resolved.model);
    case 'gemini': return new GeminiProvider(resolved.model);
    case 'claude': return new ClaudeProvider(resolved.model);
    default:
      logDemoModeWarningIfNeeded();
      return new DemoAIClient();
  }
}

let singleton: AIClient | null = null;

export function getAIClient(): AIClient {
  if (!singleton) {
    const primaryClient = createAIClient();
    const r = resolveLlmConfig();

    singleton = new Proxy(primaryClient, {
      get(target, propKey) {
        // Отримуємо оригінальний метод
        const origMethod = (target as any)[propKey];
        
        // Якщо це не функція (наприклад, властивість provider), просто повертаємо її
        if (typeof origMethod !== 'function') return origMethod;

        // Повертаємо обгортку (Proxy) для методу
        return async function (...args: any[]) {
          const is429 = (val: any) => {
            const s = JSON.stringify(val || "").toLowerCase();
            return s.includes('429') || s.includes('quota') || s.includes('rate limit');
          };

          try {
            const result = await origMethod.apply(target, args);
            
            // Якщо все добре, інкрементуємо токени, якщо вони є у відповіді
            if (result?.usage?.total_tokens) {
                 llmTokens.inc({ model: r.model, token_type: 'total' }, result.usage.total_tokens);
            }
            return result;
          } catch (error: any) {
             const msg = (error?.message || "").toString();
             const isRateLimit = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');

             // Логіка перемикання при помилці
             if (isRateLimit && config.geminiApiKey && r.provider !== 'gemini') {
                llmFailovers.inc({ from: r.provider, to: 'gemini' });
                
                const fallbackClient = new GeminiProvider(config.geminiModel);
                const result = await (fallbackClient as any)[propKey].apply(fallbackClient, args);
                
                // Інкрементуємо метрику для fallback-результату
                if (result?.usage?.total_tokens) {
                    llmTokens.inc({ model: config.geminiModel, token_type: 'total' }, result.usage.total_tokens);
                }
                return result;
             }
             throw error;
          }
        };
      }
    }) as AIClient;
  }
  return singleton;
}

export { config as aiConfig };