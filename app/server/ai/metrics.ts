import client from 'prom-client';

export const llmRequests = new client.Counter({
  name: 'llm_requests_total',
  help: 'Total AI requests',
  labelNames: ['provider', 'status']
});

export const llmFailovers = new client.Counter({
  name: 'llm_failovers_total',
  help: 'Total provider failovers',
  labelNames: ['from', 'to']
});

export const llmTokens = new client.Counter({
  name: 'jobmatch_llm_tokens_total',
  help: 'Total number of LLM tokens consumed',
  labelNames: ['provider']
});