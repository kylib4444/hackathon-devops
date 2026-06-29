import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { config } from './config.js';
import { logDemoModeWarningIfNeeded } from './ai/demo-notice.js';
import { resolveLlmConfig } from './ai/resolve.js';
import { loadAllSkills } from './ai/skills/loader.js';
import { getActiveSkillIdsForTask } from './services/llm.js';
import { loadJobBoardCatalog } from './agent/boards.js';
import { webSearchBackend } from './agent/tools/web-search.js';
import filesRoutes from './routes/files.js';
import jobsRoutes from './routes/jobs.js';
import { register, collectDefaultMetrics, Counter } from 'prom-client';

const testCounter = new Counter({
  name: 'test_metric_total',
  help: 'this is test metric to check Prometheus',
});

try {
  collectDefaultMetrics({ register });
} catch (e) {
  console.error("Metrics init error:", e);
}

const app = express();

app.get('/metrics', async (_req: any, res: any) => {
  try {
    testCounter.inc(); 
    const metrics = await register.metrics();
    res.set('Content-Type', register.contentType);
    res.send(metrics);
  } catch (ex) {
    res.status(500).send(String(ex));
  }
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  const llm = resolveLlmConfig();
  res.json({
    status: 'ok',
    demoMode: config.demoMode,
    llm: {
      provider: llm.provider,
      model: llm.model,
      jobSearchReady: !llm.demoMode,
      webSearch: webSearchBackend(),
      jobBoardsInCatalog: loadJobBoardCatalog().length,
      skillsAvailable: loadAllSkills().map((s) => s.id),
      skillsJobMatch: getActiveSkillIdsForTask('job_match'),
      skillsCvExtract: getActiveSkillIdsForTask('cv_extract'),
    },
  });
});

app.use('/api/files', filesRoutes);
app.use('/api/cv', filesRoutes);
app.use('/api/jobs', jobsRoutes);

fs.mkdirSync(config.uploadDir, { recursive: true });

app.listen(config.port, '0.0.0.0', () => {
  console.info(`[api] listening on http://0.0.0.0:${config.port}`);
  logDemoModeWarningIfNeeded();
});