import client from 'prom-client';

export const llmTokens = new client.Counter({
  name: 'jobmatch_llm_tokens_total',
  help: 'Total number of LLM tokens consumed',
  labelNames: ['model', 'token_type'] as const
});

export const llmFailovers = new client.Counter({
  name: 'llm_failovers_total',
  help: 'Total provider failovers',
  labelNames: ['from', 'to'] as const
});