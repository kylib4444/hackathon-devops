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
    console.info(`[ai] Initializing Proxy for provider: ${resolveLlmConfig().provider}`);

    singleton = new Proxy(primaryClient, {
      get(target, propKey) {
        const origMethod = (target as any)[propKey];
        if (typeof origMethod !== 'function') return origMethod;

        return async function (...args: any[]) {
          console.log(`[Proxy] Calling method: ${String(propKey)}`);
          
          try {
            const result = await origMethod.apply(target, args);
            console.log(`[Proxy] Result from ${String(propKey)}:`, JSON.stringify(result).substring(0, 100));
            
            // Перевірка 429
            const s = JSON.stringify(result || "").toLowerCase();
            if ((s.includes('429') || s.includes('quota')) && config.geminiApiKey) {
               console.warn(`⚠️ [ai] 429 detected in result. Fallback triggering.`);
               // ... (логіка фалбеку)
            }
            return result;
          } catch (error: any) {
             console.error(`[Proxy] Error in ${String(propKey)}:`, error?.message);
             throw error;
          }
        };
      }
    }) as AIClient;
  }
  return singleton;
}