import type { FastifyInstance } from "fastify";
import { ServiceError } from "../../utils/service-error";
import type { CreateCategoryBody } from "./categories.schema";
import { CategoriesRepository, type CategoryEntity, type CategoryListItem } from "./categories.repository";

export class CategoriesService {
  private readonly repository: CategoriesRepository;

  constructor(app: FastifyInstance) {
    this.repository = new CategoriesRepository(app);
  }

  async listCategories(): Promise<CategoryListItem[]> {
    return this.repository.listCategories();
  }

  async createCategory(body: CreateCategoryBody): Promise<CategoryListItem> {
    if (body.min_score > body.max_score) {
      throw new ServiceError(400, "min_score cannot be greater than max_score");
    }

    try {
      return await this.repository.insertCategory({
        name: body.name,
        type: body.type,
        minScore: body.min_score,
        maxScore: body.max_score,
        requiresReview: body.requires_review,
        description: body.description ?? null,
      });
    } catch (error: unknown) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "23505") {
        throw new ServiceError(409, "A category with this name already exists");
      }
      throw error;
    }
  }

  async getScoringConfiguration(): Promise<{ categories: CategoryEntity[] }> {
    const categories = await this.repository.listScoringConfiguration();
    return { categories };
  }
}
