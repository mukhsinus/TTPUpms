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
  /** Copied from profile for previews (not stored on submissions). */
  identityStudentFullName?: string;
  identityFaculty?: string;
  identityStudentId?: string;
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
  /** False when a linked student must finish onboarding; true for completed profiles and non-students. */
  profileComplete?: boolean;
}

export interface BotContext extends Context {
  session: BotSession;
  scene: Scenes.SceneContextScene<BotContext, SubmitFlowState>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
