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
  /** True while waiting for email text (unlinked user). */
  needsEmailLink?: boolean;
  /** Draft submission id (POST /api/bot/submissions/draft). */
  submissionId?: string;
  categories?: CategoryCatalogEntry[];
  categoryId?: string;
  categoryName?: string;
  subcategorySlug?: string;
  subcategoryLabel?: string;
  title?: string;
  description?: string;
  proofFileUrl?: string;
  /** Human-readable lines for final preview (one block per item). */
  previewBlocks?: string[];
}

export interface BotSession extends Scenes.WizardSession<SubmitFlowState> {
  authenticatedTelegramId?: string;
}

export interface BotContext extends Context {
  session: BotSession;
  scene: Scenes.SceneContextScene<BotContext, SubmitFlowState>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
