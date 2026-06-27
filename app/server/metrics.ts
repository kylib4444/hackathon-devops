import { Registry, Counter } from 'prom-client';

export const register = new Registry();

export const aiRequestCounter = new Counter({
  name: 'agentgateway_ai_requests_total',
  help: 'Total number of AI requests',
  labelNames: ['task', 'status'],
  registers: [register],
});
