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
import { register, collectDefaultMetrics } from 'prom-client';
// import mcpRoutes from './routes/mcp.js';
collectDefaultMetrics();
const app = express();

// @ts-ignore
app.get('/metrics', async (_req: any, res: any) => {
  try {
    const metrics = await register.metrics();
    console.log("DEBUG: Metrics length:", metrics.length); 
    res.set('Content-Type', register.contentType);
    res.send(metrics);
  } catch (ex) {
    console.error("DEBUG: Metrics error:", ex); 
    res.status(500).send(ex);
  }
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  const llm = resolveLlmConfig();
  res.json({
    status: 'ok',
    demoMode: config.demoMode,
    demoMessage: config.demoMode
      ? 'No LLM API keys configured. Set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY for AI features.'
      : null,
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
// app.use('/mcp', mcpRoutes);

fs.mkdirSync(config.uploadDir, { recursive: true });

app.listen(config.port, () => {
  console.info(`[api] listening on http://localhost:${config.port}`);
  console.info(`[api] demo_mode=${config.demoMode}`);
  logDemoModeWarningIfNeeded();
});
