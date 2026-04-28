import { Scenes } from "telegraf";
import {
  addAnotherItemKeyboard,
  categoryPickerKeyboard,
  mainMenuKeyboard,
  olympiadPlacementKeyboard,
  previewSubmitKeyboard,
  skipDescriptionKeyboard,
  skipOptionalLinkKeyboard,
  submitFlowNavKeyboard,
} from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext, CategoryCatalogEntry, PendingSubmissionItem, SubmitFlowState } from "../types/session";
import { withProcessingReply } from "../utils/bot-loading";
import { userFacingUpmsMessage } from "../utils/upms-user-facing";
import { botFlowStep } from "../utils/structured-log";
import { buildCategoryIntroMessage, categoryRequiresPlacementMetadata } from "../config/category-registry";

const TEN_MB = 10 * 1024 * 1024;

const NO_CATEGORIES_MSG = "No categories available. Please try later.";

const MSG_PICK_CATEGORY =
  "📋 What are you submitting?\n\nTap a category. You can add several achievements before sending everything for review.";

const MSG_DESCRIPTION_STEP =
  "📝 Describe what you did\n\n" +
  "Please include:\n" +
  "• What you did (role, project, result)\n" +
  "• When it happened (year or dates)\n" +
  "• Anything important (hours, level, organizer)\n\n" +
  "A few sentences is fine.\n\n" +
  "If needed, tap Skip.";

const MSG_PROOF_STEP =
  "📎 Upload proof\n\n" +
  "Send one file (PDF, JPG, or PNG, max 10 MB).\n\n" +
  "Accepted examples:\n" +
  "• Certificates\n" +
  "• Diploma / диплом\n" +
  "• Official letter\n" +
  "• Screenshots of results\n\n" +
  "The file should clearly support your title and description.";

const MSG_SINGLE_FILE_ONLY =
  "❌ You can upload only ONE file at a time (PDF/PNG/JPG, up to 10 MB).\n\n" +
  "Please send a single file again.";

const MSG_LINK_STEP =
  "🔗 Related link (optional)\n\n" +
  "Send an https:// link, or tap Skip.\n\n" +
  "Examples:\n" +
  "• LinkedIn post\n" +
  "• GitHub repo\n" +
  "• Official results page";

const CHANGE_CATEGORY_TEXT = "change category";

function isChangeCategoryText(text: string | undefined): boolean {
  return (text ?? "").trim().toLowerCase() === CHANGE_CATEGORY_TEXT;
}

function prettifySnake(s: string): string {
  return s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function formatSubmissionSuccessSummary(
  items: Array<{
    title: string;
    category: string;
    description: string | null;
    link: string | null;
    hasFile: boolean;
  }>,
): string {
  if (items.length === 0) {
    return "Your achievement has been submitted and is under review.";
  }

  if (items.length > 1) {
    const lines = [
      "Your achievements have been submitted and are under review.",
      "",
      "Summary:",
      "",
      ...items.map((item, index) => {
        const catLine = item.category?.includes("_") ? prettifySnake(item.category) : item.category;
        return `${index + 1}. ${item.title}\n   Category: ${catLine}`;
      }),
    ];
    return lines.join("\n");
  }

  const item = items[0]!;
  const catLine = item.category?.includes("_") ? prettifySnake(item.category) : item.category;
  const lines = [
    "Your achievement has been submitted and is under review.",
    "",
    "Summary:",
    "",
    `Title: ${item.title}`,
    `Category: ${catLine}`,
    `Description: ${item.description?.trim() ? item.description : "—"}`,
  ];
  if (item.link) {
    lines.push(`Link: ${item.link}`);
  }
  if (item.hasFile) {
    lines.push("File: attached");
  }
  return lines.join("\n");
}

function st(ctx: BotContext): SubmitFlowState {
  return ctx.wizard.state as SubmitFlowState;
}

function resetFlowState(s: SubmitFlowState): void {
  delete s.pendingItems;
  delete s.identityStudentFullName;
  delete s.identityFaculty;
  delete s.identityStudentId;
  delete s.categories;
  delete s.categoryId;
  delete s.categoryName;
  delete s.categoryDisplayTitle;
  delete s.itemMetadata;
  delete s.title;
  delete s.description;
  delete s.proofFileUrl;
  delete s.previewBlocks;
}

function clearCurrentItem(s: SubmitFlowState): void {
  delete s.categoryId;
  delete s.categoryName;
  delete s.categoryDisplayTitle;
  delete s.itemMetadata;
  delete s.title;
  delete s.description;
  delete s.proofFileUrl;
}

function hasAllowedDocumentType(mime: string | undefined): boolean {
  return mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png";
}

function isProbablyUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function leaveWithMenu(ctx: BotContext): Promise<void> {
  await ctx.scene.leave();
}

async function presentCategoryStep(ctx: BotContext, upms: UpmsService): Promise<boolean> {
  const tgId = ctx.session.authenticatedTelegramId;
  if (!tgId) {
    await ctx.reply("Session error. Use /start and try again.", mainMenuKeyboard());
    return false;
  }

  try {
    const phase = await upms.getSystemPhase();
    if (phase.phase === "evaluation") {
      await ctx.reply(
        "📌 Submission period is closed.\nCurrent phase: Evaluation.\n\nYour previous submissions remain in system.\nResults/updates will be announced later.",
        mainMenuKeyboard(),
      );
      return false;
    }
  } catch {
    // Backend phase guard still enforces close/open semantics.
  }

  const s = st(ctx);

  let me;
  try {
    me = await upms.lookupUserByTelegramId({
      telegramId: tgId,
      telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
      fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
    });
  } catch (e) {
    console.error("Submit flow: profile refresh failed:", e);
    await ctx.reply(userFacingUpmsMessage(e, "Could not verify your profile."), mainMenuKeyboard());
    return false;
  }

  if (me && me.role === "student" && !me.isProfileCompleted) {
    await ctx.reply("Complete your student profile before submitting achievements. Use /start to continue setup.");
    return false;
  }

  if (me) {
    s.identityStudentFullName = me.studentFullName ?? me.fullName ?? undefined;
    s.identityFaculty = me.faculty ?? undefined;
    s.identityStudentId = me.studentId ?? undefined;
  }

  let categories;
  try {
    categories = await withProcessingReply(ctx, () => upms.getCategoriesCatalog());
  } catch (e) {
    console.error("Submit flow: categories fetch failed:", e);
    await ctx.reply(userFacingUpmsMessage(e, "Could not load categories."), mainMenuKeyboard());
    return false;
  }

  if (!categories || categories.length === 0) {
    await ctx.reply(NO_CATEGORIES_MSG, mainMenuKeyboard());
    return false;
  }

  s.categories = categories;
  botFlowStep(ctx.from?.id, "category_prompt", { categoryCount: categories.length });
  await ctx.reply(MSG_PICK_CATEGORY, categoryPickerKeyboard(categories));
  return true;
}

async function promptForSelectedCategory(
  ctx: BotContext,
  selected: CategoryCatalogEntry,
  options?: { announceChange?: boolean; discardedDraft?: boolean },
): Promise<void> {
  const announceChange = options?.announceChange ?? false;
  const discardedDraft = options?.discardedDraft ?? false;
  if (categoryRequiresPlacementMetadata(selected)) {
    botFlowStep(ctx.from?.id, "placement_prompt", {
      categoryCode: selected.code ?? selected.name,
      switched: announceChange,
      discardedDraft,
    });
    const changedPrefix = announceChange
      ? `🔄 Category changed to ${selected.title.trim() || selected.name}.\n\n`
      : "";
    const discardedLine = discardedDraft ? "Previous unfinished draft data was discarded.\n\n" : "";
    await ctx.reply(
      `${changedPrefix}${discardedLine}🥇 Pick your placement (1st, 2nd, or 3rd) using the buttons below.`,
      olympiadPlacementKeyboard(),
    );
    await ctx.wizard.selectStep(2);
    return;
  }

  botFlowStep(ctx.from?.id, "subcategory_removed", {
    categoryCode: selected.code ?? selected.name,
    switched: announceChange,
    discardedDraft,
  });
  const changedPrefix = announceChange
    ? `🔄 Category changed to ${selected.title.trim() || selected.name}.\n\n`
    : "";
  const discardedLine = discardedDraft ? "Previous unfinished draft data was discarded.\n\n" : "";
  await ctx.reply(
    `${changedPrefix}${discardedLine}${buildCategoryIntroMessage(selected, { includeTitlePrompt: true })}`,
    submitFlowNavKeyboard(),
  );
  await ctx.wizard.selectStep(3);
}

async function switchToCategoryById(
  ctx: BotContext,
  categoryId: string,
  options?: { announceChange?: boolean },
): Promise<boolean> {
  const s = st(ctx);
  const categories = s.categories ?? [];
  const selected = categories.find((c) => c.id === categoryId);
  if (!selected) {
    await ctx.reply("Invalid category. Start again from the menu.");
    await leaveWithMenu(ctx);
    return false;
  }

  if (s.categoryId === selected.id && options?.announceChange) {
    await ctx.reply("This category is already selected. Continue filling the form.", submitFlowNavKeyboard());
    return true;
  }

  const hadUnfinishedDraft = Boolean(s.title || s.description || s.proofFileUrl || s.itemMetadata);
  clearCurrentItem(s);
  s.categoryId = selected.id;
  s.categoryName = selected.name;
  s.categoryDisplayTitle = selected.title.trim() || selected.name;

  botFlowStep(ctx.from?.id, "category_selected", {
    categoryCode: selected.code ?? selected.name,
    hasSubcategories: false,
    switched: options?.announceChange ?? false,
  });

  await promptForSelectedCategory(ctx, selected, {
    announceChange: options?.announceChange,
    discardedDraft: hadUnfinishedDraft,
  });
  return true;
}

async function handleGlobalSubmitFlowActions(ctx: BotContext, upms: UpmsService): Promise<boolean> {
  if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
    await ctx.answerCbQuery();
    await ctx.reply("Cancelled.", mainMenuKeyboard());
    await leaveWithMenu(ctx);
    return true;
  }

  if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "flow_change_category") {
    await ctx.answerCbQuery();
    await goToCategoryPickerFromSubmitFlow(ctx, upms);
    return true;
  }

  if (ctx.message && "text" in ctx.message && isChangeCategoryText(ctx.message.text)) {
    await goToCategoryPickerFromSubmitFlow(ctx, upms);
    return true;
  }

  if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data.startsWith("cat_")) {
    await ctx.answerCbQuery();
    const categoryId = ctx.callbackQuery.data.replace("cat_", "");
    await switchToCategoryById(ctx, categoryId, { announceChange: Boolean(st(ctx).categoryId) });
    return true;
  }

  return false;
}

function formatItemBlock(s: SubmitFlowState, externalLink: string | null): string {
  const proofsCount = s.proofFileUrl ? 1 : 0;
  const place = s.itemMetadata?.place;
  const placeLine =
    place === 1 || place === "1"
      ? "🏅 Placement: 1st place"
      : place === 2 || place === "2"
        ? "🏅 Placement: 2nd place"
        : place === 3 || place === "3"
          ? "🏅 Placement: 3rd place"
          : null;
  const catLine = `📂 Category: ${s.categoryDisplayTitle ?? s.categoryName ?? "—"}`;
  const body = [catLine, `📌 Title: ${s.title ?? "—"}`];
  if (placeLine) {
    body.push(placeLine);
  }
  body.push(
    `📝 Description: ${s.description ?? "—"}`,
    `📎 Files: ${proofsCount}`,
    externalLink ? `🔗 Link: ${externalLink}` : "🔗 Link: —",
  );
  return body.join("\n");
}

/** Queue current line in session only (DB write happens on final atomic submit). */
function persistItemAndRecordPreview(ctx: BotContext, externalLink: string | null): void {
  const s = st(ctx);
  const row: PendingSubmissionItem = {
    categoryId: s.categoryId!,
    title: s.title!,
    description: s.description ?? null,
    proofFileUrl: s.proofFileUrl!,
    externalLink,
    metadata:
      s.itemMetadata && Object.keys(s.itemMetadata).length > 0 ? { ...s.itemMetadata } : undefined,
  };
  s.pendingItems = s.pendingItems ?? [];
  s.pendingItems.push(row);
  s.previewBlocks = s.previewBlocks ?? [];
  s.previewBlocks.push(formatItemBlock(s, externalLink));
}

async function goToCategoryPickerFromSubmitFlow(ctx: BotContext, upms: UpmsService): Promise<void> {
  clearCurrentItem(st(ctx));
  const ok = await presentCategoryStep(ctx, upms);
  if (!ok) {
    await leaveWithMenu(ctx);
  } else {
    await ctx.wizard.selectStep(1);
  }
}

export function createSubmitSubmissionScene(upms: UpmsService): Scenes.WizardScene<BotContext> {
  return new Scenes.WizardScene<BotContext>(
    "submit-submission",
    // 0 — resolve Telegram user and start flow
    async (ctx) => {
      const fromId = ctx.from?.id;
      if (!fromId) {
        await ctx.reply("Unable to identify your Telegram account.");
        await leaveWithMenu(ctx);
        return;
      }

      const tg = String(fromId);
      resetFlowState(st(ctx));

      let linked = null;
      try {
        linked = await upms.resolveUserByTelegramId({
          telegramId: tg,
          telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
          fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
        });
      } catch (error) {
        console.error("Submit flow: user resolve failed:", error);
        await ctx.reply(userFacingUpmsMessage(error, "Could not verify your account."), mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      ctx.session.authenticatedTelegramId = tg;
      ctx.session.profileComplete =
        linked.role !== "student" || (linked.isProfileCompleted ?? false) === true;
      if (linked.role === "student" && !linked.isProfileCompleted) {
        await ctx.reply(
          "Complete your student profile before submitting achievements. Use /start to continue setup.",
        );
        await leaveWithMenu(ctx);
        return;
      }

      const ok = await presentCategoryStep(ctx, upms);
      if (!ok) {
        await leaveWithMenu(ctx);
        return;
      }
      return ctx.wizard.selectStep(1);
    },
    // 1 — category
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("👆 Please tap one of the category buttons below.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("cat_")) {
        await ctx.answerCbQuery();
        await ctx.reply("Please use the category buttons.");
        return;
      }
      return;
    },
    // 2 — optional placement metadata (no subcategory step)
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }

      const s = st(ctx);
      const categories = s.categories ?? [];
      const cat = categories.find((c) => c.id === s.categoryId);

      if (!cat) {
        await ctx.reply("Session error. Start again from the menu.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!categoryRequiresPlacementMetadata(cat)) {
        await ctx.reply(buildCategoryIntroMessage(cat, { includeTitlePrompt: true }), submitFlowNavKeyboard());
        return ctx.wizard.selectStep(3);
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery) || !ctx.callbackQuery.data.startsWith("place_")) {
        await ctx.reply("🥇 Tap 1st, 2nd, or 3rd place below.", olympiadPlacementKeyboard());
        return;
      }

      await ctx.answerCbQuery();
      const placeNum = Number(ctx.callbackQuery.data.replace("place_", ""));
      if (![1, 2, 3].includes(placeNum)) {
        await ctx.reply("Invalid placement.");
        return;
      }
      s.itemMetadata = { place: placeNum };
      botFlowStep(ctx.from?.id, "placement_selected", { place: placeNum });
      await ctx.reply(buildCategoryIntroMessage(cat, { includeTitlePrompt: true }), submitFlowNavKeyboard());
      return ctx.wizard.selectStep(3);
    },
    // 3 — title
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a short title (one line). See the examples above.");
        return;
      }

      st(ctx).title = ctx.message.text.trim();
      botFlowStep(ctx.from?.id, "title_entered", { titleLen: st(ctx).title!.length });
      await ctx.reply(MSG_DESCRIPTION_STEP, skipDescriptionKeyboard());
      return ctx.wizard.next();
    },
    // 4 — description
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }

      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "skip_description") {
        await ctx.answerCbQuery();
        st(ctx).description = null;
        botFlowStep(ctx.from?.id, "description_skipped");
        await ctx.reply(MSG_PROOF_STEP, submitFlowNavKeyboard());
        return ctx.wizard.next();
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please add a short description (what, when, details), or tap Skip.");
        return;
      }

      st(ctx).description = ctx.message.text.trim();
      botFlowStep(ctx.from?.id, "description_entered", { descriptionLen: st(ctx).description!.length });
      await ctx.reply(MSG_PROOF_STEP, submitFlowNavKeyboard());
      return ctx.wizard.next();
    },
    // 5 — file
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }

      if (ctx.message && "media_group_id" in ctx.message && ctx.message.media_group_id) {
        await ctx.reply(MSG_SINGLE_FILE_ONLY);
        return;
      }

      let fileId: string | undefined;
      let fileSize = 0;
      let mimeType: string | undefined;
      let filename = "proof";

      if (ctx.message && "document" in ctx.message && ctx.message.document) {
        const doc = ctx.message.document;
        fileId = doc.file_id;
        fileSize = doc.file_size ?? 0;
        mimeType = doc.mime_type;
        filename = doc.file_name ?? `proof-${doc.file_unique_id}`;
        if (!hasAllowedDocumentType(mimeType)) {
          await ctx.reply("❌ This file type isn’t accepted.\n\nPlease send PDF, JPG, or PNG only.");
          return;
        }
      } else if (ctx.message && "photo" in ctx.message && ctx.message.photo?.length) {
        const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = largestPhoto.file_id;
        fileSize = largestPhoto.file_size ?? 0;
        mimeType = "image/jpeg";
        filename = `photo-${largestPhoto.file_unique_id}.jpg`;
      } else {
        await ctx.reply("📎 Please send a document (PDF) or a photo (JPG/PNG) as proof.");
        return;
      }

      if (fileSize > TEN_MB) {
        await ctx.reply("❌ File is too large. Maximum size is 10 MB. Try compressing or a smaller export.");
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      if (!tgId || !fileId || !mimeType) {
        await ctx.reply("Session error. Use /start again.");
        await leaveWithMenu(ctx);
        return;
      }

      let bytes: Buffer;
      try {
        const link = await ctx.telegram.getFileLink(fileId);
        const downloadResponse = await fetch(link.toString());
        if (!downloadResponse.ok) {
          await ctx.reply("Could not download the file from Telegram. Try again.");
          return;
        }
        bytes = Buffer.from(await downloadResponse.arrayBuffer());
      } catch (error) {
        console.error("Submit flow: Telegram file download failed:", error);
        await ctx.reply("Could not download the file from Telegram. Please try sending the file again.");
        return;
      }

      let upload;
      try {
        upload = await withProcessingReply(ctx, () =>
          upms.uploadProofFile({
            telegramId: tgId,
            filename,
            mimeType: mimeType as "application/pdf" | "image/jpeg" | "image/png",
            bytes,
          }),
        );
      } catch (e) {
        console.error("Submit flow: proof upload failed:", e);
        await ctx.reply(userFacingUpmsMessage(e, "Could not upload proof to UPMS."), submitFlowNavKeyboard());
        return;
      }

      st(ctx).proofFileUrl = upload.proofFileUrl;

      botFlowStep(ctx.from?.id, "file_uploaded", { mimeType });

      await ctx.reply(MSG_LINK_STEP, skipOptionalLinkKeyboard());
      return ctx.wizard.next();
    },
    // 6 — optional link + persist item
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }

      let externalLink: string | null = null;

      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "skip_external_link") {
        await ctx.answerCbQuery();
      } else if (ctx.message && "text" in ctx.message && ctx.message.text.trim()) {
        const raw = ctx.message.text.trim();
        if (!isProbablyUrl(raw)) {
          await ctx.reply("Please send a full link starting with https:// or tap Skip.");
          return;
        }
        externalLink = raw;
      } else {
        await ctx.reply("Paste a link, or tap Skip if you don’t have one.");
        return;
      }

      const s = st(ctx);
      botFlowStep(ctx.from?.id, "link_or_skip", { hasLink: Boolean(externalLink) });
      persistItemAndRecordPreview(ctx, externalLink);

      clearCurrentItem(s);
      await ctx.reply(
        "✅ Line saved.\n\n➕ Add another achievement, or tap Preview to check everything before submit.",
        addAnotherItemKeyboard(),
      );
      return ctx.wizard.next();
    },
    // 7 — add another vs preview
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("👆 Use the buttons below.");
        return;
      }

      const data = ctx.callbackQuery.data;

      if (data === "flow_change_category") {
        await ctx.answerCbQuery();
        await goToCategoryPickerFromSubmitFlow(ctx, upms);
        return;
      }

      if (data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (data === "flow_add_more") {
        await ctx.answerCbQuery();
        const ok = await presentCategoryStep(ctx, upms);
        if (!ok) {
          await leaveWithMenu(ctx);
          return;
        }
        return ctx.wizard.selectStep(1);
      }

      if (data === "flow_preview") {
        await ctx.answerCbQuery();
        const s = st(ctx);
        const blocks = s.previewBlocks ?? [];
        if (blocks.length === 0) {
          await ctx.reply("No items yet. Add at least one achievement.", addAnotherItemKeyboard());
          return;
        }

        const s0 = st(ctx);
        const identity = [
          `Student: ${s0.identityStudentFullName ?? "—"}`,
          `Faculty: ${s0.identityFaculty ?? "—"}`,
          `Student ID: ${s0.identityStudentId ?? "—"}`,
        ].join("\n");
        const summary = [
          "🔍 Please review your submission",
          "",
          identity,
          "",
          ...blocks.map((b, i) => `━━━ Item ${i + 1} ━━━\n${b}`),
          "",
          "✅ Tap Submit if everything looks correct, or Cancel to stop.",
        ].join("\n\n");
        await ctx.reply(summary, previewSubmitKeyboard());
        return ctx.wizard.next();
      }

      await ctx.answerCbQuery();
    },
    // 8 — submit / cancel
    async (ctx) => {
      if (await handleGlobalSubmitFlowActions(ctx, upms)) {
        return;
      }
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("👆 Use Submit or Cancel below.");
        return;
      }

      if (ctx.callbackQuery.data !== "confirm_submit") {
        await ctx.answerCbQuery();
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      const s = st(ctx);
      const pending = s.pendingItems ?? [];
      if (!tgId || pending.length === 0 || !s.previewBlocks?.length) {
        await ctx.answerCbQuery();
        await ctx.reply("Incomplete session. Start again from the menu.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      await ctx.answerCbQuery("Submitting…");

      try {
        const submitted = await withProcessingReply(ctx, () =>
          upms.completeBotSubmission({
            telegramId: tgId,
            items: pending.map((it) => ({
              categoryId: it.categoryId,
              title: it.title,
              description: it.description,
              proofFileUrl: it.proofFileUrl,
              externalLink: it.externalLink,
              metadata: it.metadata,
            })),
          }),
        );
        await ctx.reply(
          formatSubmissionSuccessSummary(submitted.items),
          mainMenuKeyboard(),
        );
      } catch (e) {
        console.error("Submit flow: final submit failed:", e);
        await ctx.reply(userFacingUpmsMessage(e, "Submission failed."), mainMenuKeyboard());
      }

      resetFlowState(st(ctx));
      await leaveWithMenu(ctx);
    },
  );
}
