import pg from 'pg';
import type { Workspace } from '../src/domain';
import { initialWorkspace } from '../src/seed';

export type WorkspaceSnapshot = {
  workspace: Workspace;
  revision: number;
};

export class PostgresWorkspace {
  private readonly pool: pg.Pool;
  private initialization?: Promise<void>;

  constructor(config: pg.PoolConfig) {
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

  private async createSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize first boot when more than one app process starts against the same database.
      await client.query('SELECT pg_advisory_xact_lock(1734438247, 1)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS gatekeeper_workspace (
          singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
          workspace jsonb NOT NULL,
          revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
        )
      `);
      await client.query(
        'INSERT INTO gatekeeper_workspace (workspace) VALUES ($1) ON CONFLICT (singleton) DO NOTHING',
        [JSON.stringify(initialWorkspace)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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

  async write(snapshot: WorkspaceSnapshot): Promise<WorkspaceSnapshot | undefined> {
    await this.initialize();
    const result = await this.pool.query<WorkspaceSnapshot>(
      `UPDATE gatekeeper_workspace
       SET workspace = $1, revision = revision + 1
       WHERE singleton = true AND revision = $2
       RETURNING workspace, revision`,
      [JSON.stringify(snapshot.workspace), snapshot.revision],
    );
    return result.rows[0];
  }

  async healthy(): Promise<void> {
    await this.initialize();
    const result = await this.pool.query('SELECT 1 FROM gatekeeper_workspace WHERE singleton = true');
    if (result.rowCount !== 1) throw new Error('Workspace data is missing.');
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
