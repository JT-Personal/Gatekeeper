import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as httpsServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const directory = mkdtempSync(join(tmpdir(), 'gatekeeper-oidc-'));
const dbName = `gatekeeper-oidc-${randomUUID().slice(0, 8)}`;
const password = randomUUID();
const clientId = 'gatekeeper-test';
const clientSecret = randomUUID();
const appOrigin = 'https://gatekeeper.test';
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...signing.publicKey.export({ format: 'jwk' }), kid: 'auth-smoke-key', alg: 'RS256', use: 'sig' };
const grants = new Map();
const access = new Map();
const appProcesses = [];
let provider;
let issuer;

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', ...options }).trim();
}

async function until(action) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const result = await action();
      if (result) return result;
    } catch {
      // The listener or database may still be starting.
    }
    await pause(250);
  }
  throw new Error('A test service did not become ready.');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function json(response, body, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function jwt(claims, validSignature) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encode({ alg: 'RS256', kid: key.kid })}.${encode(claims)}`;
  const signature = sign('RSA-SHA256', Buffer.from(message), signing.privateKey);
  if (!validSignature) signature[0] ^= 1;
  return `${message}.${signature.toString('base64url')}`;
}

async function providerRequest(request, response) {
  if (request.url.endsWith('/.well-known/openid-configuration')) {
    return json(response, {
      issuer, authorization_endpoint: new URL('/authorize', issuer).href,
      token_endpoint: new URL('/token', issuer).href,
      userinfo_endpoint: new URL('/userinfo', issuer).href,
      jwks_uri: new URL('/jwks', issuer).href,
      response_types_supported: ['code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  }
  if (request.url === '/jwks') return json(response, { keys: [key] });
  if (request.url === '/userinfo') {
    const profile = access.get(request.headers.authorization?.replace(/^Bearer /, ''));
    return profile ? json(response, profile) : json(response, { error: 'invalid_token' }, 401);
  }
  if (request.url !== '/token' || request.method !== 'POST') return json(response, { error: 'not_found' }, 404);

  let body = '';
  for await (const chunk of request) body += chunk;
  const params = new URLSearchParams(body);
  const code = params.get('code');
  const grant = grants.get(code);
  const verifier = params.get('code_verifier') ?? '';
  const boundChallenge = createHash('sha256').update(verifier).digest('base64url');
  if (!grant || grant.challenge !== boundChallenge || params.get('redirect_uri') !== `${appOrigin}/auth/callback` ||
      params.get('client_id') !== clientId || params.get('client_secret') !== clientSecret) {
    return json(response, { error: 'invalid_grant' }, 400);
  }
  grants.delete(code);
  const now = Math.floor(Date.now() / 1000);
  const accessToken = randomUUID();
  const claims = {
    iss: issuer, sub: grant.subject, aud: clientId, iat: now, exp: now + 180,
    nonce: grant.wrongNonce ? 'invalid-nonce' : grant.nonce,
    ...(!grant.useUserInfo && { name: grant.name, groups: grant.groups }),
  };
  access.set(accessToken, { sub: grant.subject, name: grant.name, groups: grant.groups });
  return json(response, {
    access_token: accessToken, token_type: 'Bearer', expires_in: 180,
    id_token: jwt(claims, !grant.invalidSignature),
  });
}

async function startApp(env) {
  const probe = tcpServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const app = spawn(process.execPath, ['dist-server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      POSTGRES_HOST: '',
      AUTH_MODE: '',
      AUTH_ISSUER: '',
      AUTH_CLIENT_ID: '',
      AUTH_CLIENT_SECRET: '',
      AUTH_APP_URL: '',
      AUTH_ALLOWED_GROUP: '',
      AUTH_ADMIN_GROUP: '',
      ...env,
    },
    stdio: 'inherit',
  });
  appProcesses.push(app);
  const url = `http://127.0.0.1:${port}`;
  await until(() => fetch(`${url}/api/health`));
  return url;
}

function acceptedCookie(response, name) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`));
  assert.ok(cookie);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/i);
  assert.match(cookie, /; Secure/i);
  assert.match(cookie, /; SameSite=Lax/i);
  assert.doesNotMatch(cookie, /; Domain=/i);
  return cookie.split(';')[0];
}

async function signIn(url, identity, expectedStatus = 303) {
  const login = await fetch(`${url}/auth/login`, { redirect: 'manual' });
  assert.equal(login.status, 303);
  const flowCookie = acceptedCookie(login, '__Host-gatekeeper-oidc');
  const authorization = new URL(login.headers.get('location'));
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${appOrigin}/auth/callback`);
  const code = randomUUID();
  grants.set(code, {
    ...identity, nonce: authorization.searchParams.get('nonce'), challenge: authorization.searchParams.get('code_challenge'),
  });
  const callback = `${url}/auth/callback?${new URLSearchParams({ code, state: authorization.searchParams.get('state') })}`;
  const response = await fetch(callback, { redirect: 'manual', headers: { Cookie: flowCookie } });
  assert.equal(response.status, expectedStatus, await response.text());
  if (response.status !== 303) return;

  const sessionCookie = acceptedCookie(response, '__Host-gatekeeper-session');
  assert.equal(response.headers.get('location'), '/');
  const replay = await fetch(callback, { redirect: 'manual', headers: { Cookie: flowCookie } });
  assert.equal(replay.status, 400);
  const session = await fetch(`${url}/api/session`, { headers: { Cookie: sessionCookie } });
  assert.equal(session.status, 200);
  const { mode, user } = await session.json();
  assert.equal(mode, 'oidc');
  assert.equal(user.name, identity.name);
  return { cookie: sessionCookie, user };
}

function save(url, snapshot, cookie, origin = appOrigin) {
  return fetch(`${url}/api/workspace`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }), ...(origin && { Origin: origin }) },
    body: JSON.stringify(snapshot),
  });
}

function entry(kind, amountMinor, member, recorder = member) {
  return {
    id: randomUUID(), kind, amountMinor, date: '2026-11-18', description: 'Smoke test ledger entry',
    memberId: member.id, memberName: member.name, recordedById: recorder.id, recordedByName: recorder.name,
    createdAt: '2000-01-01T00:00:00.000Z',
  };
}

try {
  const tlsKey = join(directory, 'test-key.pem');
  const cert = join(directory, 'test-ca.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', tlsKey, '-out', cert,
  ], { stdio: 'ignore' });
  provider = httpsServer({ key: readFileSync(tlsKey), cert: readFileSync(cert) }, (request, response) => {
    providerRequest(request, response).catch(() => json(response, { error: 'server_error' }, 500));
  });
  issuer = `https://127.0.0.1:${await listen(provider)}/application/o/gatekeeper/`;

  docker([
    'run', '--rm', '-d', '--name', dbName, '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_DB=gatekeeper', '-e', 'POSTGRES_USER=gatekeeper', '-e', `POSTGRES_PASSWORD=${password}`,
    'postgres:17-alpine',
  ]);
  await until(() => docker(['exec', dbName, 'pg_isready', '-h', '127.0.0.1', '-U', 'gatekeeper', '-d', 'gatekeeper']));
  const dbPort = docker(['port', dbName, '5432']).split(':').at(-1);
  const pg = { POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: dbPort, POSTGRES_PASSWORD: password };

  const broken = await startApp({ ...pg, AUTH_MODE: 'oidc' });
  assert.equal((await fetch(`${broken}/api/workspace`)).status, 503);
  const brokenSession = await fetch(`${broken}/api/session`);
  assert.equal(brokenSession.status, 503);
  assert.equal((await brokenSession.json()).mode, 'oidc');

  const url = await startApp({
    ...pg, AUTH_MODE: 'oidc', AUTH_ISSUER: issuer, AUTH_CLIENT_ID: clientId,
    AUTH_CLIENT_SECRET: clientSecret, AUTH_APP_URL: appOrigin, NODE_EXTRA_CA_CERTS: cert,
  });
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  assert.equal((await fetch(`${url}/api/workspace`)).status, 401);

  await signIn(url, { subject: 'outsider', name: 'Outsider', groups: ['other-group'] }, 403);
  await signIn(url, { subject: 'invalid-nonce', name: 'Invalid nonce', groups: ['gatekeeper-founders'], wrongNonce: true }, 400);
  await signIn(url, { subject: 'invalid-signature', name: 'Invalid signature', groups: ['gatekeeper-founders'], invalidSignature: true }, 400);
  const founder = await signIn(url, { subject: 'founder', name: 'Founder One', groups: ['gatekeeper-founders'] });
  const admin = await signIn(url, { subject: 'admin', name: 'Admin One', groups: ['gatekeeper-admins'], useUserInfo: true });
  assert.equal(founder.user.role, 'founder');
  assert.equal(admin.user.role, 'admin');

  const read = await fetch(`${url}/api/workspace`, { headers: { Cookie: founder.cookie } });
  const snapshot = await read.json();
  assert.deepEqual(snapshot, { revision: 0, workspace: { schemaVersion: 1, projects: [] } });
  snapshot.workspace.projects.push({
    id: 'auth-smoke-project', code: 'TEST-OIDC', name: 'OIDC QA project', description: '', owner: '',
    createdAt: new Date().toISOString(), documents: [], requirements: [], failureModes: [], tests: [], signoffs: [],
    finance: { currency: 'USD', entries: [entry('expense', 200, founder.user), entry('contribution', 500, founder.user)] },
  });
  assert.equal((await save(url, snapshot, founder.cookie, 'https://cross-origin.test')).status, 403);
  assert.equal((await save(url, snapshot, founder.cookie, '')).status, 403);
  const saved = await save(url, snapshot, founder.cookie);
  assert.equal(saved.status, 200);
  const savedSnapshot = await saved.json();
  const ledger = savedSnapshot.workspace.projects[0].finance;
  assert.notEqual(ledger.entries[0].createdAt, '2000-01-01T00:00:00.000Z');
  const spoofed = structuredClone(savedSnapshot);
  spoofed.workspace.projects[0].finance.entries.push(entry('expense', 200, admin.user, founder.user));
  assert.equal((await save(url, spoofed, founder.cookie)).status, 403);

  ledger.entries.push(entry('reimbursement', 100, founder.user, admin.user));
  assert.equal((await save(url, savedSnapshot, founder.cookie)).status, 403);
  const reimbursed = await save(url, savedSnapshot, admin.cookie);
  assert.equal(reimbursed.status, 200);
  const reimbursedSnapshot = await reimbursed.json();
  assert.equal(reimbursedSnapshot.workspace.projects[0].finance.entries[2].amountMinor, 100);
  assert.equal((await save(url, savedSnapshot, admin.cookie)).status, 409);

  const trusted = await startApp({ ...pg, AUTH_MODE: 'trusted' });
  assert.equal((await (await fetch(`${trusted}/api/session`)).json()).mode, 'trusted');
  const unverified = structuredClone(reimbursedSnapshot);
  unverified.workspace.projects[0].finance.entries.push(entry('contribution', 100, founder.user));
  assert.equal((await save(trusted, unverified, null, '')).status, 403);
  reimbursedSnapshot.workspace.projects[0].description = 'Trusted APQP edit';
  assert.equal((await save(trusted, reimbursedSnapshot, null, '')).status, 200);

  async function logout(origin) {
    return fetch(`${url}/auth/logout`, {
      method: 'POST', headers: { Cookie: founder.cookie, Origin: origin },
    });
  }
  assert.equal((await logout('https://cross-origin.test')).status, 403);
  assert.equal((await fetch(`${url}/api/workspace`, { headers: { Cookie: founder.cookie } })).status, 200);
  assert.equal((await logout(appOrigin)).status, 204);
  assert.equal((await fetch(`${url}/api/workspace`, { headers: { Cookie: founder.cookie } })).status, 401);

  console.log('OIDC/PostgreSQL smoke passed for fail-closed config, replay, nonce, signature, groups, CSRF, finance roles, and logout.');
} finally {
  for (const app of appProcesses) app.kill('SIGTERM');
  provider?.close();
  try {
    docker(['rm', '-f', dbName], { stdio: 'ignore' });
  } catch {
    // The database container may not have started.
  }
  rmSync(directory, { recursive: true, force: true });
}
