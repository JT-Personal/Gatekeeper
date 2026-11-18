import pg from 'pg';
import type { Workspace } from '../src/domain';
import type { AuthUser } from './auth';

export type WorkspaceSnapshot = {
  workspace: Workspace;
  revision: number;
};

type WorkspaceChange = (current: Workspace, next: Workspace) => { workspace: Workspace } | { error: string };
type WriteResult =
  | { status: 'saved' | 'conflict'; snapshot: WorkspaceSnapshot }
  | { status: 'denied'; error: string };

type SessionRecord = {
  tokenHash: string;
  realm: string;
  user: AuthUser;
  expiresAt: Date;
  replaceTokenHash?: string;
};

type LoginAttempt = {
  state: string;
  nonce: string;
  verifier: string;
};

export class PostgresWorkspace {
  private readonly pool: pg.Pool;
  private initialization?: Promise<void>;

  constructor(config: pg.PoolConfig, private readonly seed: Workspace) {
    this.pool = new pg.Pool({
      ...config,
      max: 8,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
    });
    this.pool.on('error', (error) => console.error('PostgreSQL connection error:', error.message));
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.createSchema().catch((error) => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }

  private createSchema(): Promise<void> {
    return this.transaction(async (client) => {
      // Serialize first boot when more than one app process starts against the same database.
      await client.query('SELECT pg_advisory_xact_lock(1734438247, 1)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS gatekeeper_workspace (
          singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
          workspace jsonb NOT NULL,
          revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
        );

        CREATE TABLE IF NOT EXISTS gatekeeper_oidc_attempts (
          token_hash text PRIMARY KEY,
          realm text NOT NULL,
          state text NOT NULL,
          nonce text NOT NULL,
          verifier text NOT NULL,
          expires_at timestamptz NOT NULL
        );

        CREATE TABLE IF NOT EXISTS gatekeeper_sessions (
          token_hash text PRIMARY KEY,
          realm text NOT NULL,
          user_id text NOT NULL,
          user_name text NOT NULL,
          user_role text NOT NULL CHECK (user_role IN ('founder', 'admin')),
          expires_at timestamptz NOT NULL
        );

        CREATE INDEX IF NOT EXISTS gatekeeper_oidc_attempts_expiry_idx ON gatekeeper_oidc_attempts (expires_at);
        CREATE INDEX IF NOT EXISTS gatekeeper_sessions_expiry_idx ON gatekeeper_sessions (expires_at)
      `);
      await client.query(
        'INSERT INTO gatekeeper_workspace (workspace) VALUES ($1) ON CONFLICT (singleton) DO NOTHING',
        [JSON.stringify(this.seed)],
      );
    });
  }

  async read(): Promise<WorkspaceSnapshot> {
    await this.initialize();
    const result = await this.pool.query<WorkspaceSnapshot>(
      'SELECT workspace, revision FROM gatekeeper_workspace WHERE singleton = true',
    );
    const snapshot = result.rows[0];
    if (!snapshot) throw new Error('Workspace data is missing.');
    return snapshot;
  }

  async write(candidate: WorkspaceSnapshot, apply: WorkspaceChange): Promise<WriteResult> {
    await this.initialize();
    return this.transaction(async (client) => {
      const before = await client.query<WorkspaceSnapshot>(
        'SELECT workspace, revision FROM gatekeeper_workspace WHERE singleton = true FOR UPDATE',
      );
      const current = before.rows[0];
      if (!current) throw new Error('Workspace data is missing.');
      if (current.revision !== candidate.revision) return { status: 'conflict', snapshot: current };

      // Authorization and the update must use the same row revision.
      const proposed = apply(current.workspace, candidate.workspace);
      if ('error' in proposed) return { status: 'denied', error: proposed.error };

      const after = await client.query<WorkspaceSnapshot>(
        `UPDATE gatekeeper_workspace
         SET workspace = $1, revision = revision + 1
         WHERE singleton = true
         RETURNING workspace, revision`,
        [JSON.stringify(proposed.workspace)],
      );
      return { status: 'saved', snapshot: after.rows[0] };
    });
  }

  async createLoginAttempt(attempt: LoginAttempt & { tokenHash: string; realm: string; expiresAt: Date }): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `WITH expired AS (DELETE FROM gatekeeper_oidc_attempts WHERE expires_at <= now())
       INSERT INTO gatekeeper_oidc_attempts (token_hash, realm, state, nonce, verifier, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [attempt.tokenHash, attempt.realm, attempt.state, attempt.nonce, attempt.verifier, attempt.expiresAt],
    );
  }

  async consumeLoginAttempt(tokenHash: string, realm: string, state: string): Promise<LoginAttempt | undefined> {
    await this.initialize();
    const result = await this.pool.query<LoginAttempt>(
      `DELETE FROM gatekeeper_oidc_attempts
       WHERE token_hash = $1 AND realm = $2 AND state = $3 AND expires_at > now()
       RETURNING state, nonce, verifier`,
      [tokenHash, realm, state],
    );
    return result.rows[0];
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `WITH revoked AS (
         DELETE FROM gatekeeper_sessions
         WHERE expires_at <= now() OR (token_hash = $7 AND realm = $2)
       )
       INSERT INTO gatekeeper_sessions (token_hash, realm, user_id, user_name, user_role, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.tokenHash, session.realm, session.user.id, session.user.name, session.user.role,
        session.expiresAt, session.replaceTokenHash ?? null,
      ],
    );
  }

  async readSession(tokenHash: string, realm: string): Promise<AuthUser | null> {
    await this.initialize();
    const result = await this.pool.query<AuthUser>(
      `SELECT user_id AS id, user_name AS name, user_role AS role
       FROM gatekeeper_sessions WHERE token_hash = $1 AND realm = $2 AND expires_at > now()`,
      [tokenHash, realm],
    );
    return result.rows[0] ?? null;
  }

  async revokeSession(tokenHash: string, realm: string): Promise<void> {
    await this.initialize();
    await this.pool.query('DELETE FROM gatekeeper_sessions WHERE token_hash = $1 AND realm = $2', [tokenHash, realm]);
  }

  async healthy(): Promise<void> {
    await this.initialize();
    const result = await this.pool.query('SELECT 1 FROM gatekeeper_workspace WHERE singleton = true');
    if (result.rowCount !== 1) throw new Error('Workspace data is missing.');
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
