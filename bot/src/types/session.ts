import type { Context, Scenes } from "telegraf";

/** Category row from GET /api/bot/categories */
export interface CategoryCatalogEntry {
  id: string;
  name: string;
  type: string;
  minScore: number;
  maxScore: number;
  subcategories: Array<{ slug: string; label: string }>;
}

export interface SubmitFlowState extends Scenes.WizardSessionData {
  categories?: CategoryCatalogEntry[];
  categoryId?: string;
  categoryName?: string;
  subcategorySlug?: string;
  subcategoryLabel?: string;
  title?: string;
  description?: string;
  proofFileUrl?: string;
}

export interface BotSession extends Scenes.WizardSession<SubmitFlowState> {
  authenticatedTelegramId?: string;
}

export interface BotContext extends Context {
  session: BotSession;
  scene: Scenes.SceneContextScene<BotContext, SubmitFlowState>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
