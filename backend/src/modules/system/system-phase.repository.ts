import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import type { ProjectPhase } from "./system-phase.types";

type DbExecutor = FastifyInstance["db"] | PoolClient;

interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

interface UserBriefRow {
  id: string;
  email: string | null;
  name: string | null;
}

export class SystemPhaseRepository {
  constructor(private readonly app: FastifyInstance) {}

  async getSettings(keys: string[]): Promise<Map<string, SettingRow>> {
    if (keys.length === 0) {
      return new Map();
    }
    const result = await this.app.db.query<SettingRow>(
      `
      SELECT key, value, updated_at
      FROM public.system_settings
      WHERE key = ANY($1::text[])
      `,
      [keys],
    );
    const out = new Map<string, SettingRow>();
    for (const row of result.rows) {
      out.set(row.key, row);
    }
    return out;
  }

  async upsertSetting(client: DbExecutor, key: string, value: string): Promise<void> {
    await client.query(
      `
      INSERT INTO public.system_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [key, value],
    );
  }

  async setPhaseWithAuditMeta(input: {
    phase: ProjectPhase;
    actorUserId: string | null;
    changedAtIso: string;
  }): Promise<void> {
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");
      await this.upsertSetting(client, "project_phase", input.phase);
      await this.upsertSetting(client, "project_phase_changed_at", input.changedAtIso);
      await this.upsertSetting(client, "project_phase_changed_by", input.actorUserId ?? "system");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setDeadlines(input: {
    submissionDeadline: string | null;
    evaluationDeadline: string | null;
  }): Promise<void> {
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");
      await this.upsertSetting(client, "submission_deadline", input.submissionDeadline ?? "");
      await this.upsertSetting(client, "evaluation_deadline", input.evaluationDeadline ?? "");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserBriefById(userId: string): Promise<UserBriefRow | null> {
    const result = await this.app.db.query<UserBriefRow>(
      `
      SELECT
        id::text AS id,
        email::text AS email,
        COALESCE(NULLIF(BTRIM(student_full_name), ''), NULLIF(BTRIM(full_name), '')) AS name
      FROM public.users
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async findTelegramUserById(telegramId: string): Promise<{ user_id: string; role: string } | null> {
    const result = await this.app.db.query<{ user_id: string; role: string }>(
      `
      SELECT id::text AS user_id, role::text AS role
      FROM public.users
      WHERE telegram_id = $1::bigint
      LIMIT 1
      `,
      [telegramId],
    );
    return result.rows[0] ?? null;
  }
}
