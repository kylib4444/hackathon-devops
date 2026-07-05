import { config } from '../config.js';
import { resolveLlmConfig } from '../ai/resolve.js';
import type { JobMatchResult, JobListing } from '../types.js';
import { selectBoardsForCountry } from './boards.js';
import type { AgentToolCallLog, JobBoardDefinition, JobSearchAgentInput, RawJobListing } from './types.js';
import { fetchJobBoard } from './tools/fetch-board.js';
import { webSearchJobs } from './tools/web-search.js';
import { rankListingsWithLlm } from './synthesize.js';
import { getCachedQuery, setCachedQuery, connectCache } from '../services/cache.js';

// --- Helper Functions ---

function assertJobSearchReady(): void {
  const llm = resolveLlmConfig();
  if (llm.demoMode || llm.provider === 'demo') {
    throw new Error('Job search requires a real LLM provider.');
  }
}

function dedupeListings(collected: RawJobListing[]): RawJobListing[] {
  const seen = new Set<string>();
  return collected.filter(listing => {
    const l = listing as any; 
    const key = [l.id, l.applyUrl || l.url, l.title, l.company]
      .filter(Boolean)
      .map(val => String(val).trim())
      .join('|')
      .toLowerCase();
      
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runBoardTool(board: JobBoardDefinition, query: string, logs: AgentToolCallLog[]): Promise<RawJobListing[]> {
  try {
    if (board.parser === 'web-only') {
      return await webSearchJobs(board, query, config.jobSearchResultsPerBoard || 5);
    }
    return await fetchJobBoard(board, query);
  } catch (error) {
    console.error(`[agent] Failed for ${board.name}:`, error);
    return [];
  }
}

// --- Main Logic ---

export async function runJobSearchAgent(input: JobSearchAgentInput): Promise<JobMatchResult & { agentMeta?: any }> {
  assertJobSearchReady();
  await connectCache();

  const cached = await getCachedQuery(input.query, input.countryCode);
  if (cached) {
    return cached as any;
  }

  const boards = selectBoardsForCountry(input.countryCode, 3).slice(0, 3);
  const logs: AgentToolCallLog[] = [];
  const collected: RawJobListing[] = [];

  for (const board of boards) {
    const results = await runBoardTool(board, input.query, logs);
    collected.push(...results);
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  const merged = dedupeListings(collected);

  let result: JobMatchResult;
  try {
    result = await rankListingsWithLlm(merged, boards, {
      userPrompt: input.userPrompt,
      cvSummary: input.cvSummary,
      cvSkills: input.cvSkills,
      jsonSchema: input.jsonSchema,
    });
  } catch (e) {
    console.warn("[agent] Ranking failed, falling back to raw list.");
    result = {
      jobs: merged.slice(0, 10).map(j => ({ 
        ...(j as any), 
        score: 0, 
        reasoning: "AI ranking unavailable" 
      } as JobListing)),
      suggestions: ["Try a more specific search query."]
    };
  }

  const finalResult = { 
    ...result, 
    agentMeta: { toolCalls: logs, boardsQueried: boards.length, listingsFound: merged.length } 
  };

  try {
    await setCachedQuery(input.query, input.countryCode, finalResult);
  } catch (cacheError) {
    console.error("[agent] Non-fatal: Failed to update cache:", cacheError);
  }

  return finalResult;
}

// RESTORED EXPORT: Required by routes/mcp.ts
export async function searchRawJobs(query: string, countryCode: string = 'WORLDWIDE'): Promise<RawJobListing[]> {
  const boards = selectBoardsForCountry(countryCode, 3).slice(0, 3);
  const logs: AgentToolCallLog[] = [];
  const collected: RawJobListing[] = [];
  for (const board of boards) {
    collected.push(...await runBoardTool(board, query, logs));
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  return dedupeListings(collected);
}