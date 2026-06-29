import { config } from '../config.js';

export class GatewayClient {
  static async request(provider: string, body: any) {
    const url = `${process.env.GATEWAY_URL}/v1/chat/completions`;
    
    // Визначаємо який ключ використовувати
    const apiKey = provider === 'claude' ? config.anthropicApiKey : config.openaiApiKey;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-LLM-Provider': provider // Багато шлюзів вимагають це
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gateway Error ${res.status}: ${errorText}`);
    }
    return res.json();
  }
}