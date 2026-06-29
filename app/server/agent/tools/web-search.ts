import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';
import { parseJsonFromModelText } from '../../ai/json.js';
import { resolveLlmConfig } from '../../ai/resolve.js';
import type { JobBoardDefinition, RawJobListing } from '../types.js';

// Helper для отримання базового URL шлюзу
const getGatewayBaseURL = () => process.env.GATEWAY_URL 
  ? (process.env.GATEWAY_URL.endsWith('/v1') ? process.env.GATEWAY_URL : `${process.env.GATEWAY_URL}/v1`)
  : undefined;

interface SearchHit {
  title?: string;
  applyUrl?: string;
  company?: string;
  snippet?: string;
}

const LISTINGS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      applyUrl: { type: 'string' },
      company: { type: 'string' },
      snippet: { type: 'string' },
    },
    required: ['title', 'applyUrl'],
  },
};

function buildSearchPrompt(board: JobBoardDefinition, query: string, limit: number): string {
  return `Find up to ${limit} current job listings on ${board.name} (${board.domain}) for: "${query}".

Prefer results from site:${board.domain} ${query} jobs.

Return ONLY a JSON array of objects:
{"title":"job title","applyUrl":"https://...","company":"employer","snippet":"one line"}

Rules:
- applyUrl must be HTTPS and on ${board.domain}
- Job posting pages only (not company homepages or generic search pages)
- No markdown fences or commentary`;
}

function mapHitsToListings(hits: SearchHit[], board: JobBoardDefinition, limit: number): RawJobListing[] {
  const out: RawJobListing[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    if (out.length >= limit) break;
    const url = hit.applyUrl?.trim();
    const title = hit.title?.trim();
    if (!url || !title || !url.startsWith('http')) continue;
    if (!url.includes(board.domain)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      title,
      company: hit.company?.trim() || 'See listing',
      location: board.region,
      applyUrl: url,
      source: board.name,
      sourceBoardId: board.id,
      snippet: hit.snippet,
    });
  }
  return out;
}

function parseSearchHits(text: string): SearchHit[] {
  try {
    const parsed = parseJsonFromModelText<SearchHit[] | { listings?: SearchHit[] }>(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.listings)) return parsed.listings;
  } catch {
    // fall through
  }
  return [];
}

async function geminiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const prompt = buildSearchPrompt(board, query, limit);

  const response = await client.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseJsonSchema: LISTINGS_SCHEMA,
    },
  });

  const text = response.text ?? '';
  const hits = parseSearchHits(text);
  const candidate = response.candidates?.[0];
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web?.uri || !web.title) continue;
    hits.push({ title: web.title, applyUrl: web.uri, company: 'See listing', snippet: web.title });
  }
  return mapHitsToListings(hits, board, limit);
}

async function openaiWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const prompt = buildSearchPrompt(board, query, limit);
  const baseUrl = process.env.GATEWAY_URL || 'https://api.openai.com';
  const url = `${baseUrl.replace(/\/v1$/, '')}/v1/responses`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openaiApiKey || 'mock-key'}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: prompt,
      tools: [{ type: 'web_search' }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI web search error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  let text = data.output_text ?? '';
  return mapHitsToListings(parseSearchHits(text), board, limit);
}

async function claudeWebSearch(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const prompt = buildSearchPrompt(board, query, limit);
  const gatewayURL = process.env.GATEWAY_URL || 'https://api.anthropic.com';
  const url = `${gatewayURL.replace(/\/v1$/, '')}/v1/messages`;
  
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
      messages: [{ role: 'user', content: prompt }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude web search error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  let text = '';
  if (data.content && Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'text') text += block.text;
    }
  }

  return mapHitsToListings(parseSearchHits(text), board, limit);
}

export async function webSearchJobs(board: JobBoardDefinition, query: string, limit: number): Promise<RawJobListing[]> {
  const llm = resolveLlmConfig();
  if (llm.demoMode || llm.provider === 'demo') {
    throw new Error('Web search requires a real LLM provider.');
  }

  switch (llm.provider) {
    case 'gemini': return geminiWebSearch(board, query, limit);
    case 'openai': return openaiWebSearch(board, query, limit);
    case 'claude': return claudeWebSearch(board, query, limit);
    default: throw new Error(`Unsupported LLM: ${llm.provider}`);
  }
}

export function webSearchBackend(): string | null {
  const llm = resolveLlmConfig();
  if (llm.demoMode) return null;
  return `${llm.provider}-web-search`;
}