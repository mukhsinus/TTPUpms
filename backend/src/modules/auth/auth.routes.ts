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
const registerAdminSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  email: z.string().trim().email(),
  password: z.string().min(10).max(200),
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
        });
        reply.status(201).send(success({ ok: true }));
      } catch (error) {
        if (error instanceof z.ZodError) {
          const first = error.issues[0];
          reply.status(400).send(failure(first?.message ?? "Validation error", "VALIDATION_ERROR", {}));
          return;
        }
        if (error instanceof ServiceError) {
          reply.status(error.statusCode).send(failure(error.message, error.clientCode ?? "ERROR", {}));
          return;
        }
        reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR", {}));
      }
    },
  );
}

async function registerAdminAccount(
  app: FastifyInstance,
  input: { fullName: string; email: string; password: string },
): Promise<void> {
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
      VALUES ($1::uuid, $2::citext, 'admin'::public.user_role, NOW())
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        role = CASE
          WHEN public.admin_users.role::text = 'superadmin' THEN public.admin_users.role
          ELSE 'admin'::public.user_role
        END
      `,
      [userId, input.email],
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
