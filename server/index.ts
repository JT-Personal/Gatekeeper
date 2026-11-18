import express, { type ErrorRequestHandler } from 'express';
import { resolve } from 'node:path';
import { z } from 'zod';
import { workspaceSchema, type Workspace } from '../src/domain';
import { stampFinanceChanges, validateFinanceChanges } from '../src/finance';
import { stampPayChanges, validatePayWorkspaceChanges } from '../src/payPeriods';
import { initialWorkspace } from '../src/seed';
import { authenticatedUser, mountAuth } from './auth';
import { PostgresWorkspace } from './store';

const port = readPort(process.env.PORT, 8080, 'PORT');
const seed: Workspace = process.env.AUTH_MODE === 'trusted' ? initialWorkspace : { schemaVersion: 1, projects: [] };
const database = process.env.POSTGRES_HOST
  ? new PostgresWorkspace({
      host: process.env.POSTGRES_HOST,
      port: readPort(process.env.POSTGRES_PORT, 5432, 'POSTGRES_PORT'),
      user: process.env.POSTGRES_USER ?? 'gatekeeper',
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB ?? 'gatekeeper',
    }, seed)
  : undefined;
const app = express();
const dist = resolve(process.cwd(), 'dist');
const updateSchema = z.object({
  workspace: workspaceSchema,
  revision: z.number().int().min(0).max(2_147_483_646),
});

app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use('/api', (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});

const auth = mountAuth(app, database, process.env);

app.get('/api/health', async (_request, response) => {
  if (!auth.configured) {
    response.status(503).json({ status: 'misconfigured', storage: database ? 'postgres' : 'local' });
    return;
  }
  if (!database) {
    response.json({ status: 'ok', storage: 'local' });
    return;
  }
  await database.healthy();
  response.json({ status: 'ok', storage: 'postgres' });
});

app.use('/api', auth.protect);

app.get('/api/workspace', async (_request, response) => {
  if (!database) {
    response.status(503).json({ code: 'local_only', error: 'PostgreSQL is not configured.' });
    return;
  }
  response.json(await database.read());
});

app.put('/api/workspace', express.json({ limit: '32mb' }), async (request, response) => {
  if (!database) {
    response.status(503).json({ code: 'local_only', error: 'PostgreSQL is not configured.' });
    return;
  }
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid workspace update.', issues: parsed.error.issues.slice(0, 10) });
    return;
  }
  const actor = authenticatedUser(response);
  const result = await database.write(parsed.data, (current, next) => {
    const error = validateFinanceChanges(current, next, null) ?? validatePayWorkspaceChanges(current, next, actor);
    if (error) return { error };
    const savedAt = new Date().toISOString();
    const historicalWorkspace = stampFinanceChanges(current, next, savedAt);
    return { workspace: stampPayChanges(current, historicalWorkspace, savedAt) };
  });
  if (result.status === 'denied') {
    response.status(403).json({ code: 'finance_forbidden', error: result.error });
    return;
  }
  if (result.status === 'saved') {
    response.json(result.snapshot);
    return;
  }
  response.status(409).json({
    ...result.snapshot,
    error: 'The shared workspace was changed by another session.',
  });
});

const handleApiError: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Invalid JSON request.' });
    return;
  }
  if (error.type === 'entity.too.large') {
    response.status(413).json({ error: 'The workspace exceeds the 32 MB server limit.' });
    return;
  }
  console.error('Workspace request failed:', error.message);
  response.status(503).json({ error: 'The PostgreSQL workspace is temporarily unavailable.' });
};
app.use('/api', handleApiError);
app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});
app.use(express.static(dist));
app.get('/{*path}', (request, response) => {
  if (request.accepts(['html', 'text']) === 'html') {
    response.sendFile(resolve(dist, 'index.html'));
    return;
  }
  response.sendStatus(404);
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Gatekeeper is listening on port ${port}`);
});

function readPort(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

function shutdown(): void {
  server.close(() => {
    void database?.close().catch((error) => console.error('PostgreSQL shutdown failed:', error.message));
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
