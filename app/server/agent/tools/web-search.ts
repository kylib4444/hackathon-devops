import { config } from '../../config.js';
import { parseJsonFromModelText } from '../../ai/json.js';
import { resolveLlmConfig } from '../../ai/resolve.js';
import type { JobBoardDefinition, RawJobListing } from '../types.js';

// Пряме посилання на Gateway
const GATEWAY_URL = process.env.GATEWAY_URL || 'https://api.anthropic.com';

interface SearchHit { title?: string; applyUrl?: string; company?: string; snippet?: string; }

// --- Helper functions ---
const buildSearchPrompt = (board: JobBoardDefinition, query: string, limit: number): string => 
  `Find up to ${limit} job listings on ${board.domain} for "${query}". Return ONLY JSON array of objects: {"title":"...","applyUrl":"https://...","company":"...","snippet":"..."}`;

const mapHitsToListings = (hits: SearchHit[], board: JobBoardDefinition, limit: number): RawJobListing[] => {
  const out: RawJobListing[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (out.length >= limit) break;
    const url = hit.applyUrl?.trim();
    if (!url || !url.startsWith('http') || !url.includes(board.domain)) continue;
    if (seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    out.push({ title: hit.title || 'Job', company: hit.company || 'See listing', location: board.region, applyUrl: url, source: board.name, sourceBoardId: board.id, snippet: hit.snippet });
  }
  return out;
};

// --- Web Search Implementations (Using Fetch only) ---

async function claudeWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const url = `${GATEWAY_URL.replace(/\/v1$/, '')}/v1/messages`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': config.anthropicApiKey || 'no-key',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.claudeModel,
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildSearchPrompt(board, query, limit) }],
      // ПРИБРАЛИ tools, щоб не було 400 помилки
    }),
  });

  if (!res.ok) throw new Error(`Claude proxy error: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  const text = data.content?.[0]?.text ?? '';
  return mapHitsToListings(parseJsonFromModelText(text) as SearchHit[], board, limit);
}

async function openaiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const url = `${GATEWAY_URL.replace(/\/v1$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.openaiApiKey || 'mock-key'}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [{ role: 'user', content: buildSearchPrompt(board, query, limit) }],
    }),
  });
  
  if (!res.ok) throw new Error(`OpenAI proxy error: ${res.status}`);
  const data = await res.json() as any;
  const text = data.choices[0]?.message?.content ?? '';
  return mapHitsToListings(parseJsonFromModelText(text) as SearchHit[], board, limit);
}

// Gemini поки залишаємо як є, бо там SDK дуже специфічний
async function geminiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  // Тут ти можеш використати свій робочий код з Gemini, бо він працює
  return []; 
}

export async function webSearchJobs(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const llm = resolveLlmConfig();
  if (llm.provider === 'claude') return claudeWebSearch(board, query, limit);
  if (llm.provider === 'openai') return openaiWebSearch(board, query, limit);
  throw new Error('Unsupported provider');
}

export function webSearchBackend(): string | null { return null; }