import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import * as oidc from 'openid-client';
import type { PostgresWorkspace } from './store';

export type AuthUser = { id: string; name: string; role: 'founder' | 'admin' };

type AuthSettings =
  | { mode: 'local' }
  | { mode: 'trusted'; origin?: string }
  | {
    mode: 'oidc';
    issuer: URL;
    clientId: string;
    clientSecret: string;
    origin: string;
    allowedGroup: string;
    allowLegacyGroup: boolean;
    adminGroup: string;
  };

const legacyMemberGroup = 'gatekeeper-founders';
const sessionCookie = '__Host-gatekeeper-session';
const attemptCookie = '__Host-gatekeeper-oidc';
const sessionLifetime = 8 * 60 * 60 * 1000;
const attemptLifetime = 10 * 60 * 1000;
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
const unavailable = { code: 'auth_unavailable', error: 'Workspace authentication is unavailable.' };

export function mountAuth(app: Express, database: PostgresWorkspace | undefined, env: NodeJS.ProcessEnv) {
  let settings: AuthSettings | undefined;
  try {
    settings = readSettings(Boolean(database), env);
  } catch (error) {
    console.error('Authentication configuration error:', error instanceof Error ? error.message : 'Invalid configuration.');
  }

  const config = settings?.mode === 'oidc' && database ? createOidcService(settings, database) : undefined;

  app.use('/auth', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/session', async (request, response) => {
    if (!settings) {
      response.status(503).json({ mode: 'oidc', user: null, ...unavailable });
      return;
    }
    if (!config) {
      response.json({ mode: settings.mode, user: null });
      return;
    }
    try {
      response.json({ mode: 'oidc', user: await config.readUser(request) });
    } catch {
      response.status(503).json({ mode: 'oidc', user: null, ...unavailable });
    }
  });

  if (config) {
    app.get('/auth/login', config.login);
    app.get('/auth/callback', config.callback);
    app.post('/auth/logout', config.logout);
  } else if (!settings) {
    app.use('/auth', (_request, response) => authPage(response, 503, unavailable.error));
  }

  const protect: RequestHandler = async (request, response, next) => {
    if (!settings) {
      response.status(503).json(unavailable);
      return;
    }
    if (config) {
      const user = await config.readUser(request);
      if (!user) {
        response.status(401).json({ code: 'auth_required', error: 'Sign in to access the shared workspace.' });
        return;
      }
      response.locals.gatekeeperUser = user;
    }
    if (!browserRead(request.method) && !sameOrigin(request, settings)) {
      response.status(403).json({ code: 'origin_forbidden', error: 'This request must come from Gatekeeper.' });
      return;
    }
    next();
  };

  return { protect, configured: Boolean(settings) };
}

export function authenticatedUser(response: Response): AuthUser | null {
  return (response.locals.gatekeeperUser as AuthUser | undefined) ?? null;
}

function readSettings(hasDatabase: boolean, env: NodeJS.ProcessEnv): AuthSettings {
  const mode = env.AUTH_MODE || (hasDatabase ? 'oidc' : 'local');
  if (mode === 'local' && !hasDatabase) return { mode };
  if (!hasDatabase) throw new Error('AUTH_MODE requires PostgreSQL.');
  if (mode === 'trusted') {
    return { mode, origin: env.AUTH_APP_URL ? originUrl(env.AUTH_APP_URL).origin : undefined };
  }
  if (mode !== 'oidc') throw new Error('Set AUTH_MODE to oidc or trusted when PostgreSQL is configured.');

  const issuer = httpsUrl(env.AUTH_ISSUER, 'AUTH_ISSUER');
  const origin = originUrl(env.AUTH_APP_URL).origin;
  const clientId = env.AUTH_CLIENT_ID?.trim();
  const clientSecret = env.AUTH_CLIENT_SECRET;
  const configuredGroup = env.AUTH_ALLOWED_GROUP?.trim();
  const allowedGroup = configuredGroup || 'gatekeeper-members';
  const allowLegacyGroup = !configuredGroup;
  const adminGroup = env.AUTH_ADMIN_GROUP?.trim() || 'gatekeeper-admins';
  if (!clientId || !clientSecret) throw new Error('Set AUTH_CLIENT_ID and AUTH_CLIENT_SECRET.');
  if (allowedGroup === adminGroup || (allowLegacyGroup && adminGroup === legacyMemberGroup)) {
    throw new Error('Set distinct AUTH_ALLOWED_GROUP and AUTH_ADMIN_GROUP values.');
  }
  return { mode, issuer, clientId, clientSecret, origin, allowedGroup, allowLegacyGroup, adminGroup };
}

function httpsUrl(value: string | undefined, name: string): URL {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`Set ${name} to an HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`Set ${name} to an HTTPS URL without credentials, a query, or a fragment.`);
  }
  return url;
}

function originUrl(value: string | undefined): URL {
  const url = httpsUrl(value, 'AUTH_APP_URL');
  if (url.pathname !== '/') throw new Error('Set AUTH_APP_URL to the external origin without a path.');
  return url;
}

function browserRead(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function sameOrigin(request: Request, settings: AuthSettings): boolean {
  const origin = request.get('Origin');
  if (settings.mode === 'oidc') return origin === settings.origin;
  if (request.get('Sec-Fetch-Site') === 'cross-site') return false;
  if (!origin) return true;
  if (settings.mode === 'trusted' && settings.origin) return origin === settings.origin;
  const host = request.get('Host');
  return Boolean(host && origin === `${request.protocol}://${host}`);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function cookieToken(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  const raw = request.get('Cookie')?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}

function authPage(response: Response, status: number, message: string) {
  // Only fixed application messages are rendered here. IdP error details stay out of the page.
  response.status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gatekeeper sign-in</title></head><body><main><h1>Gatekeeper sign-in</h1><p>${message}</p><a href="/">Return to Gatekeeper</a></main></body></html>`);
}

function claimGroups(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((group) => typeof group === 'string') ? value : undefined;
}

function claimName(claims: Record<string, unknown>): string | undefined {
  return [claims.name, claims.preferred_username, claims.email]
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    ?.trim().slice(0, 120);
}

function createOidcService(settings: Extract<AuthSettings, { mode: 'oidc' }>, database: PostgresWorkspace) {
  const redirect = new URL('/auth/callback', settings.origin);
  // Configuration changes invalidate existing sessions and any in-flight callbacks.
  const realm = tokenHash(JSON.stringify([
    settings.issuer.href, settings.clientId, settings.clientSecret, settings.origin,
    // Keep the original default realm so active members can continue their existing sessions.
    settings.allowLegacyGroup ? legacyMemberGroup : settings.allowedGroup, settings.adminGroup,
  ]));
  let cachedConfiguration: Promise<oidc.Configuration> | undefined;

  function client(): Promise<oidc.Configuration> {
    cachedConfiguration ??= oidc.discovery(
      settings.issuer,
      settings.clientId,
      settings.clientSecret,
      oidc.ClientSecretPost(settings.clientSecret),
      { timeout: 8, execute: [oidc.enableNonRepudiationChecks] },
    ).catch((error: unknown) => {
      cachedConfiguration = undefined;
      throw error;
    });
    return cachedConfiguration;
  }

  async function readUser(request: Request): Promise<AuthUser | null> {
    const token = cookieToken(request, sessionCookie);
    return token ? database.readSession(tokenHash(token), realm) : null;
  }

  const login: RequestHandler = async (_request, response) => {
    try {
      const configuration = await client();
      const verifier = oidc.randomPKCECodeVerifier();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const handle = newToken();
      const authorize = oidc.buildAuthorizationUrl(configuration, {
        scope: 'openid profile email',
        redirect_uri: redirect.href,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      await database.createLoginAttempt({
        tokenHash: tokenHash(handle), realm, state, nonce, verifier, expiresAt: new Date(Date.now() + attemptLifetime),
      });
      response.cookie(attemptCookie, handle, { ...cookieOptions, maxAge: attemptLifetime });
      response.redirect(303, authorize.href);
    } catch {
      console.error('Could not start OpenID Connect sign-in. Check issuer discovery and workspace availability.');
      authPage(response, 503, 'Sign-in is temporarily unavailable.');
    }
  };

  const callback: RequestHandler = async (request, response) => {
    const handle = cookieToken(request, attemptCookie);
    const incoming = new URL(redirect);
    incoming.search = new URL(request.originalUrl, settings.origin).search;
    const states = incoming.searchParams.getAll('state');
    const state = states.length === 1 ? states[0] : undefined;
    response.clearCookie(attemptCookie, cookieOptions);
    if (!handle || !state || state.length > 128) {
      authPage(response, 400, 'This sign-in attempt expired. Return to Gatekeeper and start again.');
      return;
    }
    try {
      const attempt = await database.consumeLoginAttempt(tokenHash(handle), realm, state);
      if (!attempt) {
        authPage(response, 400, 'This sign-in attempt expired. Return to Gatekeeper and start again.');
        return;
      }
      const configuration = await client();
      const tokens = await oidc.authorizationCodeGrant(configuration, incoming, {
        pkceCodeVerifier: attempt.verifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('The identity provider did not return a subject.');
      let groups = claimGroups(claims.groups);
      let name = claimName(claims);
      if (groups === undefined && configuration.serverMetadata().userinfo_endpoint) {
        const profile = await oidc.fetchUserInfo(configuration, tokens.access_token, claims.sub);
        groups = claimGroups(profile.groups);
        name ??= claimName(profile);
      }

      const isMember = groups?.includes(settings.allowedGroup) ||
        (settings.allowLegacyGroup && groups?.includes(legacyMemberGroup));
      const role = groups?.includes(settings.adminGroup) ? 'admin' : isMember ? 'founder' : undefined;
      if (!role) {
        authPage(response, 403, 'Your Authentik account needs a Gatekeeper access group.');
        return;
      }
      const user: AuthUser = { id: tokenHash(`${settings.issuer.href}\0${claims.sub}`), name: name ?? 'Gatekeeper member', role };
      const token = newToken();
      const previous = cookieToken(request, sessionCookie);
      await database.createSession({
        tokenHash: tokenHash(token), realm, user,
        expiresAt: new Date(Date.now() + sessionLifetime),
        replaceTokenHash: previous && tokenHash(previous),
      });
      response.cookie(sessionCookie, token, { ...cookieOptions, maxAge: sessionLifetime });
      response.redirect(303, '/');
    } catch {
      console.error('OpenID Connect sign-in could not be completed. Check the provider configuration and workspace availability.');
      authPage(response, 400, 'Gatekeeper could not complete sign-in. Return to Gatekeeper and try again.');
    }
  };

  const logout: RequestHandler = async (request, response) => {
    if (!sameOrigin(request, settings)) {
      response.status(403).json({ code: 'origin_forbidden', error: 'This request must come from Gatekeeper.' });
      return;
    }
    const token = cookieToken(request, sessionCookie);
    try {
      if (token) await database.revokeSession(tokenHash(token), realm);
      response.clearCookie(sessionCookie, cookieOptions);
      response.sendStatus(204);
    } catch {
      response.status(503).json(unavailable);
    }
  };

  return { readUser, login, callback, logout };
}
