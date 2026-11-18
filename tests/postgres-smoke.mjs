import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const project = `gatekeeper-smoke-${randomUUID().slice(0, 8)}`;
const tempDir = mkdtempSync(join(tmpdir(), 'gatekeeper-smoke-'));
const override = join(tempDir, 'compose.yaml');
const image = `gatekeeper:${project}`;
const env = {
  ...process.env,
  APP_PORT: '0',
  APP_BIND: '127.0.0.1',
  POSTGRES_PASSWORD: randomUUID(),
};

writeFileSync(override, `services:\n  gatekeeper:\n    image: ${image}\n`);

function compose(args, capture = false) {
  return execFileSync('docker', ['compose', '-p', project, '-f', 'compose.yaml', '-f', override, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

function appUrl() {
  const address = compose(['port', 'gatekeeper', '8080'], true).trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  return `http://${address}`;
}

function readWorkspace(url) {
  return fetch(`${url}/api/workspace`);
}

function updateWorkspace(url, snapshot) {
  return fetch(`${url}/api/workspace`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
}

try {
  compose(['up', '--build', '--wait', '--wait-timeout', '90']);
  const url = appUrl();
  const home = await fetch(url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>Gatekeeper/i);

  const health = await fetch(`${url}/api/health`);
  assert.deepEqual(await health.json(), { status: 'ok', storage: 'postgres' });

  const initial = await readWorkspace(url);
  assert.equal(initial.status, 200);
  const snapshot = await initial.json();
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.workspace.projects[0].documents.length, 19);

  const malformed = await updateWorkspace(url, { ...snapshot, workspace: { schemaVersion: -1 } });
  assert.equal(malformed.status, 400);

  const candidates = ['Smoke test update A', 'Smoke test update B'].map((description) => {
    const candidate = structuredClone(snapshot);
    candidate.workspace.projects[0].description = description;
    return updateWorkspace(url, candidate);
  });
  const results = await Promise.all(candidates);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const saved = await results.find((result) => result.status === 200).json();
  const conflict = await results.find((result) => result.status === 409).json();
  assert.equal(saved.revision, 1);
  assert.equal(conflict.revision, saved.revision);
  assert.deepEqual(conflict.workspace, saved.workspace);

  compose(['down']);
  compose(['up', '--no-build', '--wait', '--wait-timeout', '90']);
  const reloaded = await readWorkspace(appUrl());
  assert.equal(reloaded.status, 200);
  assert.deepEqual(await reloaded.json(), saved);
  console.log('PostgreSQL smoke check passed for bootstrap, validation, concurrent saves, and volume persistence.');
} catch (error) {
  try {
    compose(['logs', '--tail', '80']);
  } catch {
    // Preserve the original failure if Compose cannot collect diagnostics.
  }
  throw error;
} finally {
  try {
    compose(['down', '--volumes', '--remove-orphans']);
  } finally {
    spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' });
    rmSync(tempDir, { recursive: true, force: true });
  }
}
