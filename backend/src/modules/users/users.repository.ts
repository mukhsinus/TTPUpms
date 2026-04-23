import type { FastifyInstance } from "fastify";
import { ServiceError } from "../../utils/service-error";
import { normalizeStudentId } from "../../utils/student-id";

export interface UserProfileEntity {
  id: string;
  email: string | null;
  fullName: string | null;
  studentFullName: string | null;
  degree: "bachelor" | "master" | null;
  faculty: string | null;
  studentId: string | null;
  phone: string | null;
  isProfileCompleted: boolean;
  role: "student" | "reviewer" | "admin" | "superadmin";
}

interface UserProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  student_full_name: string | null;
  degree: string | null;
  faculty: string | null;
  student_id: string | null;
  phone: string | null;
  is_profile_completed: boolean;
  role: string;
}

function parseRole(value: string): UserProfileEntity["role"] {
  if (value === "student" || value === "reviewer" || value === "admin" || value === "superadmin") {
    return value;
  }
  return "student";
}

function mapProfile(row: UserProfileRow): UserProfileEntity {
  const deg = row.degree;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    studentFullName: row.student_full_name,
    degree: deg === "bachelor" || deg === "master" ? deg : null,
    faculty: row.faculty,
    studentId: row.student_id,
    phone: row.phone,
    isProfileCompleted: row.is_profile_completed,
    role: parseRole(row.role),
  };
}

export class UsersRepository {
  constructor(private readonly app: FastifyInstance) {}

  async findProfileByUserId(userId: string): Promise<UserProfileEntity | null> {
    const result = await this.app.db.query<UserProfileRow>(
      `
      SELECT
        id,
        email::text AS email,
        full_name,
        student_full_name,
        degree::text AS degree,
        faculty,
        student_id,
        phone,
        is_profile_completed,
        role::text AS role
      FROM public.users
      WHERE id = $1
      `,
      [userId],
    );

    const row = result.rows[0];
    return row ? mapProfile(row) : null;
  }

  /**
   * Students must complete onboarding before creating or submitting work. Admins/reviewers are not blocked.
   */
  async assertStudentProfileCompleteForSubmission(userId: string): Promise<void> {
    const result = await this.app.db.query<{ role: string; is_profile_completed: boolean }>(
      `
      SELECT role::text AS role, is_profile_completed
      FROM public.users
      WHERE id = $1
      `,
      [userId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new ServiceError(404, "User not found");
    }

    if (row.role !== "student") {
      return;
    }

    if (!row.is_profile_completed) {
      throw new ServiceError(
        403,
        "Complete your student profile (name, degree, faculty, student ID) before using submissions.",
        "PROFILE_INCOMPLETE",
      );
    }
  }

  async updateProfile(userId: string, input: {
    studentFullName: string;
    degree: "bachelor" | "master";
    faculty: string;
    studentId: string;
    phone?: string;
  }): Promise<UserProfileEntity> {
    const normalizedStudentId = normalizeStudentId(input.studentId);
    const duplicate = await this.app.db.query<{ id: string }>(
      `
      SELECT id
      FROM public.users
      WHERE id <> $1
        AND upper(regexp_replace(COALESCE(student_id, ''), '\\s+', '', 'g')) = $2
      LIMIT 1
      `,
      [userId, normalizedStudentId],
    );
    if (duplicate.rows[0]) {
      throw new ServiceError(409, "Student ID already exists", "DUPLICATE_STUDENT_ID");
    }

    const params: unknown[] = [userId, input.studentFullName, input.degree, input.faculty, normalizedStudentId];
    let phoneSql = "";
    if (input.phone !== undefined) {
      params.push(input.phone);
      phoneSql = `, phone = $${params.length}::text`;
    }

    const result = await this.app.db.query<UserProfileRow>(
      `
      UPDATE public.users
      SET
        student_full_name = $2,
        degree = $3::text,
        faculty = $4,
        student_id = $5,
        ${phoneSql ? phoneSql.slice(2) : "phone = phone"},
        is_profile_completed = true,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        email::text AS email,
        full_name,
        student_full_name,
        degree::text AS degree,
        faculty,
        student_id,
        phone,
        is_profile_completed,
        role::text AS role
      `,
      params,
    );

    const row = result.rows[0];
    if (!row) {
      throw new ServiceError(404, "User not found");
    }

    return mapProfile(row);
  }
}
