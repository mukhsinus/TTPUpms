import { Scenes } from "telegraf";
import {
  addAnotherItemKeyboard,
  cancelOnlyKeyboard,
  categoryPickerKeyboard,
  mainMenuKeyboard,
  previewSubmitKeyboard,
  skipOptionalLinkKeyboard,
  subcategoryPickerKeyboard,
} from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext, SubmitFlowState } from "../types/session";
import { userFacingUpmsMessage } from "../utils/upms-user-facing";

const TEN_MB = 10 * 1024 * 1024;

const NO_CATEGORIES_MSG = "No categories available. Please try later.";

function formatSubmissionSuccessSummary(item: {
  title: string;
  category: string;
  subcategory: string;
  description: string;
  link: string | null;
  hasFile: boolean;
}): string {
  const lines = [
    "Your achievement has been submitted and is under review.",
    "",
    "Summary:",
    "",
    `Title: ${item.title}`,
    `Category: ${item.category}`,
    `Subcategory: ${item.subcategory}`,
    `Description: ${item.description}`,
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
  delete s.submissionId;
  delete s.identityStudentFullName;
  delete s.identityFaculty;
  delete s.identityStudentId;
  delete s.categories;
  delete s.categoryId;
  delete s.categoryName;
  delete s.subcategorySlug;
  delete s.subcategoryLabel;
  delete s.title;
  delete s.description;
  delete s.proofFileUrl;
  delete s.previewBlocks;
}

function clearCurrentItem(s: SubmitFlowState): void {
  delete s.categoryId;
  delete s.categoryName;
  delete s.subcategorySlug;
  delete s.subcategoryLabel;
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
    categories = await upms.getCategoriesCatalog();
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
  await ctx.reply("Select a category:", categoryPickerKeyboard(categories));
  return true;
}

function formatItemBlock(s: SubmitFlowState, externalLink: string | null): string {
  const fileNote = s.proofFileUrl ? "Proof file attached" : "—";
  return [
    `Title: ${s.title ?? "—"}`,
    `Category: ${s.categoryName ?? "—"}`,
    `Subcategory: ${s.subcategoryLabel ?? "—"}`,
    `Description: ${s.description ?? "—"}`,
    `File: ${fileNote}`,
    externalLink ? `Link: ${externalLink}` : "Link: —",
  ].join("\n");
}

/** Persist current item; updates previewBlocks. Draft row is created on first save using the user-entered title. */
async function persistItemAndRecordPreview(ctx: BotContext, upms: UpmsService, externalLink: string | null): Promise<void> {
  const tgId = ctx.session.authenticatedTelegramId!;
  const s = st(ctx);
  const subSlug = s.subcategorySlug ?? "general";

  if (!s.submissionId) {
    const draft = await upms.createDraftSubmission(tgId, s.title!);
    s.submissionId = draft.submissionId;
  }

  await upms.addSubmissionItem({
    telegramId: tgId,
    submissionId: s.submissionId!,
    categoryId: s.categoryId!,
    subcategory: subSlug,
    title: s.title!,
    description: s.description!,
    proofFileUrl: s.proofFileUrl!,
    externalLink,
  });

  s.previewBlocks = s.previewBlocks ?? [];
  s.previewBlocks.push(formatItemBlock(s, externalLink));
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
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please choose a category using the buttons below.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("cat_")) {
        await ctx.answerCbQuery();
        await ctx.reply("Please use the category buttons.");
        return;
      }

      const categoryId = data.replace("cat_", "");
      const categories = st(ctx).categories ?? [];
      const selected = categories.find((c) => c.id === categoryId);
      if (!selected) {
        await ctx.answerCbQuery();
        await ctx.reply("Invalid category. Start again from the menu.");
        await leaveWithMenu(ctx);
        return;
      }

      await ctx.answerCbQuery();
      const s = st(ctx);
      s.categoryId = selected.id;
      s.categoryName = selected.name;

      if (selected.subcategories.length === 0) {
        s.subcategorySlug = "general";
        s.subcategoryLabel = "General";
        await ctx.reply("Enter a short title for this achievement:", cancelOnlyKeyboard());
        return ctx.wizard.selectStep(3);
      }

      await ctx.reply("Select a subcategory:", subcategoryPickerKeyboard(selected.subcategories));
      return ctx.wizard.next();
    },
    // 2 — subcategory
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please choose a subcategory using the buttons.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("sub_")) {
        await ctx.answerCbQuery();
        await ctx.reply("Please use the subcategory buttons.");
        return;
      }

      const slug = data.replace("sub_", "");
      const s = st(ctx);
      const categories = s.categories ?? [];
      const cat = categories.find((c) => c.id === s.categoryId);
      const sub = cat?.subcategories.find((x) => x.slug === slug);
      if (!sub) {
        await ctx.answerCbQuery();
        await ctx.reply("Invalid subcategory.");
        return;
      }

      await ctx.answerCbQuery();
      s.subcategorySlug = sub.slug;
      s.subcategoryLabel = sub.label;

      await ctx.reply("Enter a short title for this achievement:", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 3 — title
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a non-empty title.");
        return;
      }

      st(ctx).title = ctx.message.text.trim();
      await ctx.reply("Describe the achievement (details, dates, role):", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 4 — description
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a non-empty description.");
        return;
      }

      st(ctx).description = ctx.message.text.trim();
      await ctx.reply("Upload proof (PDF, JPG, or PNG, max 10 MB).", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 5 — file
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
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
          await ctx.reply("Invalid file type. Use PDF, JPG, or PNG only.");
          return;
        }
      } else if (ctx.message && "photo" in ctx.message && ctx.message.photo?.length) {
        const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = largestPhoto.file_id;
        fileSize = largestPhoto.file_size ?? 0;
        mimeType = "image/jpeg";
        filename = `photo-${largestPhoto.file_unique_id}.jpg`;
      } else {
        await ctx.reply("Please upload a document or photo.");
        return;
      }

      if (fileSize > TEN_MB) {
        await ctx.reply("File is too large. Maximum size is 10 MB.");
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      if (!tgId || !fileId || !mimeType) {
        await ctx.reply("Session error. Use /start again.");
        await leaveWithMenu(ctx);
        return;
      }

      const link = await ctx.telegram.getFileLink(fileId);
      const downloadResponse = await fetch(link.toString());
      if (!downloadResponse.ok) {
        await ctx.reply("Could not download the file from Telegram. Try again.");
        return;
      }

      const bytes = Buffer.from(await downloadResponse.arrayBuffer());
      let upload;
      try {
        upload = await upms.uploadProofFile({
          telegramId: tgId,
          filename,
          mimeType: mimeType as "application/pdf" | "image/jpeg" | "image/png",
          bytes,
        });
      } catch (e) {
        console.error("Submit flow: proof upload failed:", e);
        await ctx.reply(userFacingUpmsMessage(e, "Could not upload proof to UPMS."), cancelOnlyKeyboard());
        return;
      }

      st(ctx).proofFileUrl = upload.proofFileUrl;

      await ctx.reply(
        "Optional: send a related link (https://…), or tap Skip.",
        skipOptionalLinkKeyboard(),
      );
      return ctx.wizard.next();
    },
    // 6 — optional link + persist item
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      let externalLink: string | null = null;

      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "skip_external_link") {
        await ctx.answerCbQuery();
      } else if (ctx.message && "text" in ctx.message && ctx.message.text.trim()) {
        const raw = ctx.message.text.trim();
        if (!isProbablyUrl(raw)) {
          await ctx.reply("Send a valid http(s) URL, or tap Skip.");
          return;
        }
        externalLink = raw;
      } else {
        await ctx.reply("Send a link or tap Skip.");
        return;
      }

      const s = st(ctx);
      try {
        await persistItemAndRecordPreview(ctx, upms, externalLink);
      } catch (e) {
        await ctx.reply(
          `Could not save this item: ${userFacingUpmsMessage(e, "Unknown error")}. Check your data and try again.`,
          cancelOnlyKeyboard(),
        );
        return;
      }

      clearCurrentItem(s);
      await ctx.reply("Item saved. Add another achievement line, or preview and submit.", addAnotherItemKeyboard());
      return ctx.wizard.next();
    },
    // 7 — add another vs preview
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Use the buttons below.");
        return;
      }

      const data = ctx.callbackQuery.data;

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
          "Preview — submit when ready:",
          "",
          identity,
          "",
          ...blocks.map((b, i) => `— Item ${i + 1} —\n${b}`),
        ].join("\n\n");
        await ctx.reply(summary, previewSubmitKeyboard());
        return ctx.wizard.next();
      }

      await ctx.answerCbQuery();
    },
    // 8 — submit / cancel
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Use Submit or Cancel.");
        return;
      }

      if (ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (ctx.callbackQuery.data !== "confirm_submit") {
        await ctx.answerCbQuery();
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      const s = st(ctx);
      if (!tgId || !s.submissionId || !s.previewBlocks?.length) {
        await ctx.answerCbQuery();
        await ctx.reply("Incomplete session. Start again from the menu.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      await ctx.answerCbQuery("Submitting…");

      try {
        const submitted = await upms.submitDraft(tgId, s.submissionId);
        const first = submitted.items[0];
        await ctx.reply(
          first
            ? formatSubmissionSuccessSummary(first)
            : "Your achievement has been submitted and is under review.",
          mainMenuKeyboard(),
        );
      } catch (e) {
        console.error("Submit flow: final submit failed:", e);
        await ctx.reply(userFacingUpmsMessage(e, "Submission failed."), mainMenuKeyboard());
      }

      await leaveWithMenu(ctx);
    },
  );
}
