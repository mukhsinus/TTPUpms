import type { Context, Scenes } from "telegraf";

export interface SubmitWizardSession extends Scenes.WizardSessionData {
  category?: string;
  details?: string;
  proofFileUrl?: string;
}

export interface BotSession extends Scenes.WizardSession<SubmitWizardSession> {
  authenticatedUserId?: string;
}

export interface BotContext extends Context {
  session: BotSession;
  scene: Scenes.SceneContextScene<BotContext, SubmitWizardSession>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
