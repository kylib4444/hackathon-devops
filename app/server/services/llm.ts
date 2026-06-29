import { config } from '../config.js';
import { getAIClient } from '../ai/AIClient.js';
import { selectSkillsForTask } from '../ai/skills/loader.js';
import type { CvExtractionResult, JobMatchResult } from '../types.js';
import { runJobSearchAgent } from '../agent/JobSearchAgent.js';
import { llmTokens } from '../ai/metrics.js'; // ВИПРАВЛЕНО: імпорт з правильного місця

const JOB_SYSTEM =
  'You are an expert career advisor. (Demo mode — sample listings only.)';
const CV_SYSTEM =
  'You are a resume parser. Extract structured CV data accurately from the provided text.';

export interface JobMatchRequest {
  prompt: string;
  query: string;
  countryCode: string;
  countryName: string;
  timeRange?: string;
  salaryHint?: string;
  cvSummary?: string;
  cvSkills?: string[];
  response_json_schema: Record<string, unknown>;
}

/** Agentic multi-board job search; falls back to DemoAIClient when no LLM keys are set. */
export async function runAgenticJobMatch(req: JobMatchRequest): Promise<JobMatchResult> {
  if (config.demoMode) {
    const client = getAIClient();
    return client.generateStructured<JobMatchResult>({
      task: 'job_match',
      systemPrompt: JOB_SYSTEM,
      userPrompt: req.prompt,
      jsonSchema: req.response_json_schema,
    });
  }

  // Phase 1: Local orchestration (crawling job boards and LLM ranking). LLM requests are routed via AgentGateway.
  return runJobSearchAgent({
    query: req.query,
    countryCode: req.countryCode,
    countryName: req.countryName,
    timeRange: req.timeRange,
    salaryHint: req.salaryHint,
    userPrompt: req.prompt,
    cvSummary: req.cvSummary,
    cvSkills: req.cvSkills,
    jsonSchema: req.response_json_schema,
  });
}


export async function extractCvStructured({
  text,
  json_schema,
}: {
  text: string;
  json_schema: Record<string, unknown>;
}): Promise<CvExtractionResult> {
  const client = getAIClient();
  const output = await client.generateStructured<Record<string, unknown>>({
    task: 'cv_extract',
    systemPrompt: CV_SYSTEM,
    userPrompt: `CV text:\n\n${text}`,
    jsonSchema: json_schema,
  });

  if ('status' in output && output.status === 'success' && 'output' in output) {
    return output as unknown as CvExtractionResult;
  }
  return { status: 'success', output };
}

/** Skill folder ids attached to a given LLM task. */
export function getActiveSkillIdsForTask(task: 'job_match' | 'cv_extract'): string[] {
  return selectSkillsForTask(task).map((s) => s.id);
}