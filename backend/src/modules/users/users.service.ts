import { ServiceError } from "../../utils/service-error";
import type { AuthUser } from "../../types/auth-user";
import type { UsersRepository, UserProfileEntity } from "./users.repository";
import type { UpdateUserProfileBody } from "./users.schema";

export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async getCurrentUserProfile(user: AuthUser): Promise<UserProfileEntity> {
    const profile = await this.repository.findProfileByUserId(user.id);
    if (!profile) {
      throw new ServiceError(404, "User not found");
    }
    return profile;
  }

  async updateUserProfile(user: AuthUser, body: UpdateUserProfileBody): Promise<UserProfileEntity> {
    if (user.role !== "student") {
      throw new ServiceError(403, "Only students can update this profile through this endpoint");
    }

    return this.repository.updateProfile(user.id, {
      studentFullName: body.student_full_name,
      degree: body.degree,
      faculty: body.faculty,
      studentId: body.student_id,
      phone: body.phone,
    });
  }
}
