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
    console.info(`[ai] Initializing Proxy for provider: ${r.provider}`);

    singleton = new Proxy(primaryClient, {
      get(target, propKey) {
        const origMethod = (target as any)[propKey];
        if (typeof origMethod !== 'function') return origMethod;

        return async function (...args: any[]) {
          const is429 = (val: any) => {
            const s = JSON.stringify(val || "").toLowerCase();
            return s.includes('429') || s.includes('quota') || s.includes('rate limit');
          };

          try {
            const result = await origMethod.apply(target, args);
            
            // Якщо API повернуло помилку в тілі JSON
            if (is429(result) && config.geminiApiKey && r.provider !== 'gemini') {
               console.warn(`⚠️ [ai] 429 detected in result. Fallback triggering.`);
               const fallbackClient = new GeminiProvider(config.geminiModel);
               return await (fallbackClient as any)[propKey].apply(fallbackClient, args);
            }
            return result;
          } catch (error: any) {
              const msg = (error?.message || "").toString();
              const isRateLimit = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
              
              console.error(`[Proxy] Caught error: ${msg}`);
              console.error(`[Proxy] Condition status: RateLimit=${isRateLimit}, HasKey=${!!config.geminiApiKey}, Provider=${r.provider}`);

              if (isRateLimit && config.geminiApiKey && r.provider !== 'gemini') {
                console.warn(`⚠️ [ai] Перехоплено 429. Перемикаю на Gemini!`);
                const fallbackClient = new GeminiProvider(config.geminiModel);
                return await (fallbackClient as any)[propKey].apply(fallbackClient, args);
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