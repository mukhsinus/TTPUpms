import type { FastifyInstance } from "fastify";
import { ServiceError } from "../../utils/service-error";

export interface UserProfileEntity {
  id: string;
  email: string;
  fullName: string | null;
  studentFullName: string | null;
  degree: "bachelor" | "master" | null;
  faculty: string | null;
  studentId: string | null;
  isProfileCompleted: boolean;
  role: "student" | "reviewer" | "admin" | "superadmin";
}

interface UserProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  student_full_name: string | null;
  degree: string | null;
  faculty: string | null;
  student_id: string | null;
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
  }): Promise<UserProfileEntity> {
    const result = await this.app.db.query<UserProfileRow>(
      `
      UPDATE public.users
      SET
        student_full_name = $2,
        degree = $3::text,
        faculty = $4,
        student_id = $5,
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
        is_profile_completed,
        role::text AS role
      `,
      [userId, input.studentFullName, input.degree, input.faculty, input.studentId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new ServiceError(404, "User not found");
    }

    return mapProfile(row);
  }
}
