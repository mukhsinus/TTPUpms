import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  isAdminEmail,
  isAdminUsersListed,
  parseAdminEmailSet,
  syncPublicUserRoleFromAuth,
} from "../../auth/public-user-sync";
import { env } from "../../config/env";
import { authMiddleware } from "../../middleware/auth.middleware";
import type { AppRole } from "../../types/auth-user";
import { failure, success } from "../../utils/http-response";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { AdminProfileService } from "../admin/admin-profile.service";
import { ServiceError } from "../../utils/service-error";

const ADMIN_EMAIL_SET = parseAdminEmailSet(env.ADMIN_EMAILS);
const REGISTER_PASSWORD_MIN = 6;
const registerAdminSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  email: z.string().trim().email(),
  password: z
    .string()
    .min(REGISTER_PASSWORD_MIN, `Password must be at least ${REGISTER_PASSWORD_MIN} characters`)
    .max(200),
});

function readAdminPanelLoginHeader(request: FastifyRequest): boolean {
  const raw = request.headers["x-upms-auth-source"] ?? request.headers["X-Upms-Auth-Source"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.trim().toLowerCase() === "admin_panel";
}

function isAuthMeGet(request: FastifyRequest): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const path = request.url.split("?")[0] ?? "";
  return path === "/api/auth/me" || path.endsWith("/api/auth/me") || path === "/me";
}

function toRole(value: unknown): AppRole | null {
  if (value === "admin" || value === "reviewer" || value === "student" || value === "superadmin") {
    return value;
  }
  return null;
}

function readUserAgent(request: FastifyRequest): string | null {
  const raw = request.headers["user-agent"];
  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  return raw ?? null;
}

function toClientRegisterErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Unexpected server error";
  }
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "23505") {
    return "Email already registered";
  }
  if (message.toLowerCase().includes("password")) {
    return `Password must be at least ${REGISTER_PASSWORD_MIN} characters`;
  }
  return "Unexpected server error";
}

async function ensureAdminSecurityTables(app: FastifyInstance): Promise<void> {
  await app.db.query(`
    CREATE TABLE IF NOT EXISTS public.admin_security_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
      type text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending',
      approved_by uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
      approved_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT admin_security_events_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
      CONSTRAINT admin_security_events_type_check CHECK (
        type IN ('new_device_login', 'logout_others_request', 'admin_registration')
      )
    )
  `);
  await app.db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_security_events_pending
    ON public.admin_security_events (status, type, created_at DESC)
    WHERE status = 'pending'
  `);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const notifications = new NotificationService(app);
  const audit = new AuditLogRepository(app);
  const profileService = new AdminProfileService(app, notifications, audit);

  app.get("/me", { preHandler: authMiddleware }, async (request, reply): Promise<void> => {
    await handleMe(app, request, reply, profileService);
  });

  app.post(
    "/register",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        const body = registerAdminSchema.parse(request.body);
        await registerAdminAccount(app, {
          fullName: body.full_name,
          email: body.email.trim().toLowerCase(),
          password: body.password,
        }, notifications);
        reply.status(201).send(success({ ok: true }));
      } catch (error) {
        request.log.error({ err: error }, "Admin registration failed");
        if (error instanceof z.ZodError) {
          const first = error.issues[0];
          reply.status(400).send(failure(first?.message ?? "Validation error", "VALIDATION_ERROR", {}));
          return;
        }
        if (error instanceof ServiceError) {
          reply.status(error.statusCode).send(failure(error.message, error.clientCode ?? "ERROR", {}));
          return;
        }
        const message = toClientRegisterErrorMessage(error);
        const statusCode =
          message === "Email already registered" ? 409 : message === "Unexpected server error" ? 500 : 400;
        reply.status(statusCode).send(failure(message, statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "VALIDATION_ERROR", {}));
      }
    },
  );
}

async function registerAdminAccount(
  app: FastifyInstance,
  input: { fullName: string; email: string; password: string },
  notifications: NotificationService,
): Promise<void> {
  await ensureAdminSecurityTables(app);
  const { data, error } = await app.supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
    app_metadata: { role: "admin" },
  });
  if (error || !data.user?.id) {
    const msg = error?.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      throw new ServiceError(409, "Email already registered", "CONFLICT");
    }
    if (msg.includes("password")) {
      throw new ServiceError(400, `Password must be at least ${REGISTER_PASSWORD_MIN} characters`, "VALIDATION_ERROR");
    }
    throw new ServiceError(502, error?.message ?? "Failed to create auth user", "AUTH_CREATE_FAILED");
  }

  const userId = data.user.id;
  const client = await app.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
      INSERT INTO public.users (id, email, role, full_name)
      VALUES ($1::uuid, $2::citext, 'admin'::public.user_role, $3)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = CASE
          WHEN public.users.role::text = 'superadmin' THEN public.users.role
          ELSE 'admin'::public.user_role
        END,
        full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
        updated_at = NOW()
      `,
      [userId, input.email, input.fullName],
    );
    await client.query(
      `
      INSERT INTO public.admin_users (id, email, role, created_at)
      VALUES ($1::uuid, $2::citext, 'admin', NOW())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = CASE
          WHEN public.admin_users.role::text = 'superadmin' THEN public.admin_users.role
          ELSE 'admin'
        END
      `,
      [userId, input.email],
    );
    await client.query(
      `
      INSERT INTO public.admin_security_events (
        admin_id,
        type,
        metadata,
        status,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        'admin_registration',
        $2::jsonb,
        'pending',
        NOW(),
        NOW()
      )
      `,
      [
        userId,
        JSON.stringify({
          fullName: input.fullName,
          email: input.email,
          requestedAt: new Date().toISOString(),
          source: "self_register",
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (dbErr) {
    await client.query("ROLLBACK");
    try {
      await app.supabaseAdmin.auth.admin.deleteUser(userId);
    } catch {
      /* best effort cleanup */
    }
    throw dbErr;
  } finally {
    client.release();
  }

  app.log.info({ userId, email: input.email }, "Admin registration request created and queued for superadmin approval");
  notifications.notifySuperadminsSecurityAlert(
    `New admin registration request: ${input.fullName} <${input.email}>. Review in Security Center.`,
  );
}

async function handleMe(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  profileService: AdminProfileService,
): Promise<void> {
  if (!request.user || !request.authIdentity) {
    reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
    return;
  }

  const id = request.user.id;
  const pool = app.db;
  const adminPanelLogin = readAdminPanelLoginHeader(request) && isAuthMeGet(request);

  const existing = await pool.query<{ role: string }>(
    `SELECT role::text AS role FROM public.users WHERE id = $1 LIMIT 1`,
    [id],
  );
  const hasRow = Boolean(existing.rows[0]);
  let roleText = existing.rows[0]?.role;

  const listedInAdminUsers = adminPanelLogin ? await isAdminUsersListed(pool, id) : false;
  const envListedAdmin = isAdminEmail(request.authIdentity?.email, ADMIN_EMAIL_SET);
  const allowAdminPanelSync = adminPanelLogin && (listedInAdminUsers || envListedAdmin);

  if (!hasRow) {
    const { roleText: synced } = await syncPublicUserRoleFromAuth(pool, request.authIdentity, ADMIN_EMAIL_SET, {
      adminPanelLogin: allowAdminPanelSync,
    });
    roleText = synced;
  } else if (allowAdminPanelSync) {
    const { roleText: synced } = await syncPublicUserRoleFromAuth(pool, request.authIdentity, ADMIN_EMAIL_SET, {
      adminPanelLogin: true,
    });
    roleText = synced;
  }

  const role = toRole(roleText) ?? request.user.role;

  if (role === "admin") {
    await ensureAdminSecurityTables(app);
    const regDecision = await pool.query<{ status: "pending" | "approved" | "rejected" }>(
      `
      SELECT status::text AS status
      FROM public.admin_security_events
      WHERE admin_id = $1::uuid
        AND type = 'admin_registration'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [id],
    );
    const latestRegistrationStatus = regDecision.rows[0]?.status;
    if (latestRegistrationStatus === "pending") {
      reply
        .status(403)
        .send(
          failure(
            "Your admin account is pending superadmin approval. You can sign in after confirmation.",
            "ADMIN_APPROVAL_PENDING",
            {},
          ),
        );
      return;
    }
    if (latestRegistrationStatus === "rejected") {
      reply
        .status(403)
        .send(
          failure(
            "Access denied. This admin account was rejected by superadmin.",
            "ADMIN_APPROVAL_REJECTED",
            {},
          ),
        );
      return;
    }
  }

  if (adminPanelLogin && (role === "admin" || role === "superadmin")) {
    const rawSessionToken = request.headers["x-admin-session-id"];
    const sessionToken = Array.isArray(rawSessionToken) ? rawSessionToken[0] : rawSessionToken;
    void profileService
      .recordAdminPanelLogin({
        adminId: id,
        sessionToken: (sessionToken ?? request.id).trim(),
        requestIp: request.ip,
        userAgent: readUserAgent(request),
      })
      .catch((err) => {
        request.log.warn({ err, userId: id }, "Deferred admin login security tracking failed");
      });
  }

  reply.header("Cache-Control", "private, no-store");
  reply.send(
    success({
      userId: id,
      email: request.user.email,
      role,
    }),
  );
}
