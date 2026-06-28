import { config } from '../config.js';
import { resolveLlmConfig } from './resolve.js';
import { DemoAIClient } from './providers/demo.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { ClaudeProvider } from './providers/claude.js';
import type { AIClient, LlmProviderId } from './types.js';
import { logDemoModeWarningIfNeeded } from './demo-notice.js';

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
    case 'openai':
      return new OpenAIProvider(resolved.model);
    case 'gemini':
      return new GeminiProvider(resolved.model);
    case 'claude':
      return new ClaudeProvider(resolved.model);
    default:
      logDemoModeWarningIfNeeded();
      return new DemoAIClient();
  }
}

let singleton: AIClient | null = null;

/** Shared AI client (provider chosen from environment). */
export function getAIClient(): AIClient {
  if (!singleton) {
    const primaryClient = createAIClient();
    const r = resolveLlmConfig();
    console.info(`[ai] provider=${r.provider} model=${r.model} demo=${r.demoMode}`);
    
    if (r.demoMode) {
      logDemoModeWarningIfNeeded();
    } else {
      const keyHint: Record<LlmProviderId, string> = {
        openai: 'OPENAI_API_KEY',
        gemini: 'GEMINI_API_KEY',
        claude: 'ANTHROPIC_API_KEY',
        demo: '',
      };
      console.info(`[ai] docs: OpenAI https://developers.openai.com/api/docs/ | Gemini https://github.com/google-gemini/api-examples | Claude https://docs.anthropic.com/`);
      if (keyHint[r.provider]) {
        console.info(`[ai] active credential: ${keyHint[r.provider]}`);
      }
    }

    singleton = new Proxy(primaryClient, {
      get(target, propKey) {
        const origMethod = (target as any)[propKey];
        // Якщо це функція (виклик до API)
        if (typeof origMethod === 'function') {
          return async function (...args: any[]) {
            try {
              // 1. Спроба виконати запит через основного провайдера
              return await origMethod.apply(target, args);
            } catch (error: any) {
              // 2. Перевіряємо, чи це помилка лімітів (429 або quota)
              const isRateLimit = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('quota');
              
              // 3. Запобіжник: робимо фалбек на Gemini, тільки якщо ми ВЖЕ не на Gemini
              if (isRateLimit && config.geminiApiKey && r.provider !== 'gemini') {
                console.warn(`⚠️ [ai] Провайдер ${r.provider} повернув 429 (Rate Limit). Автоматичний фалбек на Gemini...`);
                
                // Створюємо клієнт Gemini на льоту
                const fallbackClient = new GeminiProvider(config.geminiModel);
                const fallbackMethod = (fallbackClient as any)[propKey];
                
                // Виконуємо той самий метод з тими ж аргументами, але через Gemini
                return await fallbackMethod.apply(fallbackClient, args);
              }
              
              // Якщо це не 429 (наприклад, 401 або 500) - прокидаємо помилку далі
              throw error;
            }
          };
        }
        return origMethod;
      }
    }) as AIClient;
  }
  return singleton;
}