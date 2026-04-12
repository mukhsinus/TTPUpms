import type { FastifyInstance } from "fastify";
import { CategoriesRepository, type CategoryEntity } from "./categories.repository";

export class CategoriesService {
  private readonly repository: CategoriesRepository;

  constructor(app: FastifyInstance) {
    this.repository = new CategoriesRepository(app);
  }

  async getScoringConfiguration(): Promise<{ categories: CategoryEntity[] }> {
    const categories = await this.repository.listScoringConfiguration();
    return { categories };
  }
}
