import { config } from '../../config.js';
import { resolveLlmConfig } from '../../ai/resolve.js';
import { parseJsonFromModelText } from '../../ai/json.js';
import type { JobBoardDefinition, RawJobListing } from '../types.js';

// Прямий виклик до шлюзу
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
 * Універсальна функція для запиту до LLM через шлюз
 */
async function callGateway(provider: string, prompt: string) {
  const isClaude = provider === 'claude';
  const url = isClaude 
    ? `${GATEWAY_URL.replace(/\/v1$/, '')}/v1/messages`
    : `${GATEWAY_URL.replace(/\/v1$/, '')}/v1/chat/completions`;

  const apiKey = isClaude ? config.anthropicApiKey : config.openaiApiKey;
  
  const body = isClaude 
    ? {
        model: config.claudeModel,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      }
    : {
        model: config.openaiModel,
        messages: [{ role: 'user', content: prompt }]
      };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (isClaude) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!res.ok) {
    throw new Error(`Gateway Error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as any;
  return isClaude ? data.content[0].text : data.choices[0].message.content;
}

export async function webSearchJobs(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const llm = resolveLlmConfig();
  if (llm.demoMode || llm.provider === 'demo') {
    throw new Error('Web search requires a real LLM provider.');
  }

  const prompt = buildSearchPrompt(board, query, limit);
  const responseText = await callGateway(llm.provider, prompt);
  
  const hits = parseJsonFromModelText(responseText) as SearchHit[];
  return mapHitsToListings(Array.isArray(hits) ? hits : [], board, limit);
}

export function webSearchBackend(): string | null {
  return null; 
}