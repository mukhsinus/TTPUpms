import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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

const ADMIN_EMAIL_SET = parseAdminEmailSet(env.ADMIN_EMAILS);

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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", { preHandler: authMiddleware }, async (request, reply): Promise<void> => {
    await handleMe(app, request, reply);
  });
}

async function handleMe(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<void> {
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

  reply.send(
    success({
      userId: id,
      email: request.user.email,
      role,
    }),
  );
}
