import { config } from '../../config.js';
import { parseJsonFromModelText } from '../../ai/json.js';
import { resolveLlmConfig } from '../../ai/resolve.js';
import type { JobBoardDefinition, RawJobListing } from '../types.js';

function buildSearchPrompt(board: JobBoardDefinition, query: string, limit: number): string {
  return `Find up to ${limit} job listings on ${board.domain} for "${query}". 
Return ONLY a valid JSON array of objects:
[{"title":"...","applyUrl":"https://...","company":"...","snippet":"..."}]`;
}

function mapHitsToListings(hits: any[], board: JobBoardDefinition, limit: number): RawJobListing[] {
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

async function claudeWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  console.warn(`[stub] Claude is missing valid key. Returning empty results for ${board.name}.`);
  return [];
}

async function openaiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  // ВИПРАВЛЕНО: Використовуємо GATEWAY_URL, якщо він є, для активації фейловеру
  const baseUrl = process.env.GATEWAY_URL || 'https://api.openai.com';
  const url = `${baseUrl}/v1/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [{ role: 'user', content: buildSearchPrompt(board, query, limit) }],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI/Gateway error ${res.status}: ${errorText}`);
  }

  const data = await res.json() as any;
  const text = data.choices[0]?.message?.content ?? '';
  return mapHitsToListings(parseJsonFromModelText(text) as any[], board, limit);
}

export async function webSearchJobs(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const llm = resolveLlmConfig();
  if (llm.demoMode || llm.provider === 'demo') {
    throw new Error('Web search requires a real LLM provider.');
  }

  if (llm.provider === 'claude') return claudeWebSearch(board, query, limit);
  if (llm.provider === 'openai') return openaiWebSearch(board, query, limit);
  
  return [];
}

export function webSearchBackend(): string | null {
  return null;
}