import { config } from '../../config.js';
import { parseJsonFromModelText } from '../../ai/json.js';
import { resolveLlmConfig } from '../../ai/resolve.js';
import type { JobBoardDefinition, RawJobListing } from '../types.js';

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://api.anthropic.com';

interface SearchHit {
  title?: string;
  applyUrl?: string;
  company?: string;
  snippet?: string;
}

function buildSearchPrompt(board: JobBoardDefinition, query: string, limit: number): string {
  return `Find up to ${limit} job listings on ${board.domain} for "${query}". 
Return ONLY a valid JSON array of objects without markdown fences:
[{"title":"...","applyUrl":"https://...","company":"...","snippet":"..."}]`;
}

function mapHitsToListings(hits: SearchHit[], board: JobBoardDefinition, limit: number): RawJobListing[] {
  const out: RawJobListing[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    if (out.length >= limit) break;
    const url = hit.applyUrl?.trim();
    if (!url || !url.startsWith('http') || !url.includes(board.domain)) continue;
    
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      title: hit.title || 'Job Listing',
      company: hit.company || 'See listing',
      location: board.region,
      applyUrl: url,
      source: board.name,
      sourceBoardId: board.id,
      snippet: hit.snippet,
    });
  }
  return out;
}

/**
 * Заглушка для Claude: перехоплює помилки (напр., 401 через відсутність ключа) і повертає порожній масив.
 */
async function claudeWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const url = `${GATEWAY_URL.replace(/\/v1$/, '')}/v1/messages`;
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.anthropicApiKey || 'mock-key'}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.claudeModel,
        max_tokens: 4096,
        messages: [{ role: 'user', content: buildSearchPrompt(board, query, limit) }],
      }),
    });

    if (!res.ok) {
      console.warn(`[stub] Claude search failed (${res.status}) on ${board.name}. Ignoring and returning empty results.`);
      return [];
    }

    const data = await res.json() as any;
    const text = data.content?.[0]?.text ?? '';
    return mapHitsToListings(parseJsonFromModelText(text) as SearchHit[], board, limit);
  } catch (error) {
    console.warn(`[stub] Claude connection error on ${board.name}. Returning empty results.`);
    return [];
  }
}

async function openaiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const url = `${GATEWAY_URL.replace(/\/v1$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey || 'mock-key'}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [{ role: 'user', content: buildSearchPrompt(board, query, limit) }],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI proxy error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as any;
  const text = data.choices[0]?.message?.content ?? '';
  return mapHitsToListings(parseJsonFromModelText(text) as SearchHit[], board, limit);
}

// Залишаємо Gemini без змін, якщо він наразі не викликається або працює як є
async function geminiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  return []; 
}

export async function webSearchJobs(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const llm = resolveLlmConfig();
  if (llm.demoMode || llm.provider === 'demo') {
    throw new Error('Web search requires a real LLM provider.');
  }

  if (llm.provider === 'claude') return claudeWebSearch(board, query, limit);
  if (llm.provider === 'openai') return openaiWebSearch(board, query, limit);
  if (llm.provider === 'gemini') return geminiWebSearch(board, query, limit);
  
  throw new Error(`Unsupported LLM: ${llm.provider}`);
}

export function webSearchBackend(): string | null {
  return null;
}