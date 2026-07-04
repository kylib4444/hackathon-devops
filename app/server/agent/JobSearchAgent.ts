import { config } from '../config.js';
import { resolveLlmConfig } from '../ai/resolve.js';
import type { JobMatchResult } from '../types.js';
import { selectBoardsForCountry } from './boards.js';
import type { AgentToolCallLog, JobSearchAgentInput, RawJobListing } from './types.js';
import { fetchJobBoard } from './tools/fetch-board.js';
import { webSearchJobs } from './tools/web-search.js';
import { rankListingsWithLlm } from './synthesize.js';
import { getCachedQuery, setCachedQuery, connectCache } from '../services/cache.js';

const MAX_BOARDS_PER_SEARCH = 3;

function assertJobSearchReady(): void {
  const llm = resolveLlmConfig();
  if (llm.demoMode || llm.provider === 'demo') {
    throw new Error('Job search requires a real LLM provider. Set API keys and DEMO_MODE=false.');
  }
}

function dedupeListings(listings: RawJobListing[]): RawJobListing[] {
  const seen = new Set<string>();
  const out: RawJobListing[] = [];
  for (const l of listings) {
    const key = l.applyUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

async function runBoardTool(board: any, query: string, logs: AgentToolCallLog[]): Promise<RawJobListing[]> {
  const logBase = { boardId: board.id, boardName: board.name };
  try {
    if (board.parser !== 'web-only' && board.searchUrlTemplate) {
      const fetched = await fetchJobBoard(board, query);
      logs.push({ ...logBase, tool: 'fetch_job_board', status: 'ok', found: fetched.length });
      if (fetched.length > 0) return fetched;
    }
    const fromWeb = await webSearchJobs(board, query, config.jobSearchResultsPerBoard);
    logs.push({ ...logBase, tool: 'web_search_jobs', status: 'ok', found: fromWeb.length });
    return fromWeb;
  } catch (err) {
    console.error(`[agent] Error fetching board ${board.name}:`, err);
    return [];
  }
}

export async function runJobSearchAgent(input: JobSearchAgentInput) {
  assertJobSearchReady();
  await connectCache();

  const boards = selectBoardsForCountry(input.countryCode, MAX_BOARDS_PER_SEARCH).slice(0, 3);
  const logs: AgentToolCallLog[] = [];
  const collected: RawJobListing[] = [];

  for (const board of boards) {
    console.info(`[agent] Fetching ${board.name} sequentially...`);
    collected.push(...await runBoardTool(board, input.query, logs));
    await new Promise(resolve => setTimeout(resolve, 4000));
  }

  const merged = dedupeListings(collected);

  // FALLBACK LOGIC: Bypass LLM if quota is exhausted
  let ranked;
  try {
    ranked = await rankListingsWithLlm(merged, boards, {
      userPrompt: input.userPrompt,
      cvSummary: input.cvSummary,
      cvSkills: input.cvSkills,
      jsonSchema: input.jsonSchema,
    });
  } catch (e) {
    console.error("[agent] LLM quota exhausted, falling back to raw list.");
    ranked = {
      matches: merged.slice(0, 10).map(job => ({ 
        ...job, 
        score: 0, 
        reasoning: "AI ranking unavailable (quota limit reached)" 
      })),
      summary: "Showing raw results because AI quota limit was reached."
    };
  }

  return { ...ranked, agentMeta: { toolCalls: logs, boardsQueried: boards.length, listingsFound: merged.length } };
}