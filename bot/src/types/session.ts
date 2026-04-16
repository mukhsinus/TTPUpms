import type { Context, Scenes } from "telegraf";

/** Category row from GET /api/bot/categories */
export interface CategoryCatalogEntry {
  id: string;
  code: string;
  title: string;
  name: string;
  description: string | null;
  type: string;
  minScore: number;
  maxScore: number;
  /** True when API exposes at least one selectable sub-line (matches backend). */
  hasSubcategories: boolean;
  subcategories: Array<{
    slug: string;
    label: string;
    /** Human-readable button text (no slug). */
    title: string;
    minScore: number;
    maxScore: number;
    scoringMode: string;
    defaultPoints?: number | null;
  }>;
}

export interface SubmitFlowState extends Scenes.WizardSessionData {
  /** Draft submission id (POST /api/bot/submissions/draft). */
  submissionId?: string;
  /** Copied from profile for previews (not stored on submissions). */
  identityStudentFullName?: string;
  identityFaculty?: string;
  identityStudentId?: string;
  categories?: CategoryCatalogEntry[];
  categoryId?: string;
  categoryName?: string;
  /** API category.title for previews (human, no snake_case). */
  categoryDisplayTitle?: string;
  subcategorySlug?: string;
  subcategoryLabel?: string;
  /** e.g. olympiads: { place: 1 | 2 | 3 } */
  itemMetadata?: Record<string, string | number | boolean>;
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
