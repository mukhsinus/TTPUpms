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
  /** Universal UX copy (filled in client from API + rules; no per-category branching in UI). */
  whatCounts: string;
  scoring: string;
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

/** One queued line; persisted only after POST /api/bot/submissions/complete. */
export interface PendingSubmissionItem {
  categoryId: string;
  subcategorySlug: string | null;
  title: string;
  description: string | null;
  proofFileUrl: string;
  externalLink: string | null;
  metadata?: Record<string, string | number | boolean>;
}

export interface SubmitFlowState extends Scenes.WizardSessionData {
  /** Lines saved in-session until final atomic submit. */
  pendingItems?: PendingSubmissionItem[];
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
  description?: string | null;
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
