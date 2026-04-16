import { Scenes } from "telegraf";
import {
  addAnotherItemKeyboard,
  cancelOnlyKeyboard,
  categoryPickerKeyboard,
  mainMenuKeyboard,
  olympiadPlacementKeyboard,
  previewSubmitKeyboard,
  skipOptionalLinkKeyboard,
  subcategoryPickerKeyboard,
} from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext, CategoryCatalogEntry, SubmitFlowState } from "../types/session";
import { userFacingUpmsMessage } from "../utils/upms-user-facing";
import { botFlowStep } from "../utils/structured-log";

const TEN_MB = 10 * 1024 * 1024;

const NO_CATEGORIES_MSG = "No categories available. Please try later.";

const MSG_PICK_CATEGORY =
  "📋 What are you submitting?\n\nTap a category. You can add several achievements before sending everything for review.";

const MSG_TITLE_STEP =
  "✏️ Enter a short title for your achievement\n\n" +
  "Examples:\n" +
  "• IELTS 7.5 certificate\n" +
  "• Hackathon winner 2025\n" +
  "• Internship at Google\n\n" +
  "Keep it short and clear — one line is enough.";

const MSG_DESCRIPTION_STEP =
  "📝 Describe what you did\n\n" +
  "Please include:\n" +
  "• What you did (role, project, result)\n" +
  "• When it happened (year or dates)\n" +
  "• Anything important (hours, level, organizer)\n\n" +
  "A few sentences is fine.";

const MSG_PROOF_STEP =
  "📎 Upload proof\n\n" +
  "Send one file (PDF, JPG, or PNG, max 10 MB).\n\n" +
  "Accepted examples:\n" +
  "• Certificates\n" +
  "• Diploma / диплом\n" +
  "• Official letter\n" +
  "• Screenshots of results\n\n" +
  "The file should clearly support your title and description.";

const MSG_LINK_STEP =
  "🔗 Related link (optional)\n\n" +
  "Send an https:// link, or tap Skip.\n\n" +
  "Examples:\n" +
  "• LinkedIn post\n" +
  "• GitHub repo\n" +
  "• Official results page";

const MSG_SUBCATEGORY_PROMPT =
  "🎯 Choose the specific type\n\nPlease choose a specific type of achievement for this category:";

type CategoryUxFallback = { body: string; whatCounts: string[]; scoring: string[] };

/** When `category.description` is empty — official-style guidance only in the bot (no API change). */
const CATEGORY_UX_FALLBACKS: Record<string, CategoryUxFallback> = {
  internal_competitions: {
    body: "Contests and competitions held inside the university (faculty or whole university level).",
    whatCounts: [
      "Official contests with documented results",
      "Your rank or prize (if applicable)",
      "Organizer and level (faculty vs university)",
    ],
    scoring: ["Points follow the official rubric for this category", "Final score is set after review"],
  },
  IT_certificates: {
    body: "Industry IT and cloud certifications (vendor exams, professional tracks, courses with assessment).",
    whatCounts: [
      "Valid certificate or transcript of a recognized exam",
      "Level that matches the certificate type you select next",
    ],
    scoring: ["Range depends on certificate tier", "Reviewers verify authenticity and level"],
  },
  language_certificates: {
    body: "Language exams such as IELTS, TOEFL, or equivalent standardized language tests.",
    whatCounts: ["Official score report or certificate", "Test date and band/score visible on the document"],
    scoring: ["Bands map to fixed steps in the rubric", "Final points after review"],
  },
  standardized_tests: {
    body: "Standardized tests such as SAT / GRE / GMAT (or equivalents configured in UPMS).",
    whatCounts: ["Official score report", "Test type and date"],
    scoring: ["Band-based fixed points", "Caps apply per official rules"],
  },
  scientific_activity: {
    body: "Research output: papers, patents, conferences, projects, and comparable scientific work.",
    whatCounts: ["Publication, patent number, conference name, or clear project role", "Dates and your contribution"],
    scoring: ["Mixed fixed and range lines", "Expert review may apply for some lines"],
  },
  olympiads: {
    body: "Subject olympiads, hackathons, and competitions with placement or official ranking.",
    whatCounts: ["Official invitation, diploma, or results listing your place", "National or international level when applicable"],
    scoring: ["Placement (1st / 2nd / 3rd) drives points where configured", "Final score after review"],
  },
  volunteering: {
    body: "Volunteering and civic engagement recognized by the university (e.g. student union, university departments).",
    whatCounts: ["Role, organization, period", "Letter or proof from the responsible office when possible"],
    scoring: ["Range scoring at category level", "Final points after review"],
  },
  work_experience: {
    body: "Paid work, internships, or professional roles relevant to your studies or career.",
    whatCounts: ["Employer, position, dates", "Contract, HR letter, or official internship confirmation"],
    scoring: ["Duration bucket affects points", "Final score after review"],
  },
  educational_activity: {
    body: "Contributions to educational quality: materials, exams, digital content, peer learning, etc.",
    whatCounts: ["What you produced or facilitated", "Department or course context if applicable"],
    scoring: ["Manual / expert scoring", "Capped per official rules"],
  },
  student_initiatives: {
    body: "Student-led initiatives that improve student life (e.g. organizing study courses).",
    whatCounts: ["Your role and scope", "Evidence of delivery (schedule, attendance, recommendation)"],
    scoring: ["Manual / expert scoring", "Capped per official rules"],
  },
};

function categoryUxKey(cat: CategoryCatalogEntry): string {
  return (cat.code || cat.name).trim();
}

function bullets(lines: string[]): string {
  return lines.map((l) => `• ${l}`).join("\n");
}

function buildCategoryIntro(cat: CategoryCatalogEntry): string {
  const key = categoryUxKey(cat);
  const fb = CATEGORY_UX_FALLBACKS[key] ?? {
    body: "Submit an achievement that fits this category in UPMS.",
    whatCounts: ["Clear, honest description", "Proof that matches your title"],
    scoring: ["Points are assigned after admin/reviewer review"],
  };
  const title = (cat.title?.trim() || cat.name.replace(/_/g, " ")).trim() || cat.name;
  const main = (cat.description ?? "").trim() || fb.body;
  const band =
    Number.isFinite(cat.minScore) && Number.isFinite(cat.maxScore)
      ? `Typical band for this category: ${cat.minScore}–${cat.maxScore} points (before caps).`
      : null;
  const scoringLines = [...fb.scoring, ...(band ? [band] : [])];
  return (
    `📂 ${title}\n\n` +
    `${main}\n\n` +
    `💡 What counts:\n` +
    `${bullets(fb.whatCounts)}\n\n` +
    `🏆 Scoring:\n` +
    `${bullets(scoringLines)}\n\n` +
    `Next: a short title, then details and proof.`
  );
}

function friendlyPersistenceError(e: unknown): string {
  const raw = userFacingUpmsMessage(e, "Unknown error");
  const lower = raw.toLowerCase();
  if (
    lower.includes("no subcategories configured") ||
    lower.includes("subcategory is required") ||
    lower.includes("unknown subcategory")
  ) {
    return (
      "We couldn’t save this line.\n\n" +
      "• If the category asks for a type below the description, pick it from the buttons first.\n" +
      "• Otherwise go back, choose the category again, and follow each step.\n\n" +
      "If it keeps failing, wait a moment and try again or contact support."
    );
  }
  return raw;
}

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
    `Subcategory: ${item.subcategory?.trim() ? item.subcategory : "—"}`,
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

function categoryHasSubcategories(entry: CategoryCatalogEntry): boolean {
  return entry.hasSubcategories ?? entry.subcategories.length > 0;
}

function resetFlowState(s: SubmitFlowState): void {
  delete s.submissionId;
  delete s.identityStudentFullName;
  delete s.identityFaculty;
  delete s.identityStudentId;
  delete s.categories;
  delete s.categoryId;
  delete s.categoryName;
  delete s.categoryDisplayTitle;
  delete s.subcategorySlug;
  delete s.subcategoryLabel;
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
  delete s.subcategorySlug;
  delete s.subcategoryLabel;
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
  botFlowStep(ctx.from?.id, "category_prompt", { categoryCount: categories.length });
  await ctx.reply(MSG_PICK_CATEGORY, categoryPickerKeyboard(categories));
  return true;
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
  const subLine =
    s.subcategoryLabel && String(s.subcategoryLabel).trim() !== ""
      ? `🎯 Subcategory: ${s.subcategoryLabel}`
      : null;
  const body = [catLine, ...(subLine ? [subLine] : []), `📌 Title: ${s.title ?? "—"}`];
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

/** Persist current item; updates previewBlocks. Draft row is created on first save using the user-entered title. */
async function persistItemAndRecordPreview(ctx: BotContext, upms: UpmsService, externalLink: string | null): Promise<void> {
  const tgId = ctx.session.authenticatedTelegramId!;
  const s = st(ctx);
  const subSlug = s.subcategorySlug;

  if (!s.submissionId) {
    const draft = await upms.createDraftSubmission(tgId, s.title!);
    s.submissionId = draft.submissionId;
  }

  await upms.addSubmissionItem({
    telegramId: tgId,
    submissionId: s.submissionId!,
    categoryId: s.categoryId!,
    subcategory: subSlug ?? null,
    title: s.title!,
    description: s.description!,
    proofFileUrl: s.proofFileUrl!,
    externalLink,
    metadata: s.itemMetadata,
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
        await ctx.reply("👆 Please tap one of the category buttons below.");
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
      {
        const t = selected.title?.trim();
        s.categoryDisplayTitle =
          t && t.length > 0 ? t : selected.name.replace(/_/g, " ").trim() || selected.name;
      }

      botFlowStep(ctx.from?.id, "category_selected", {
        categoryCode: selected.code ?? selected.name,
        hasSubcategories: categoryHasSubcategories(selected),
      });

      await ctx.reply(buildCategoryIntro(selected), cancelOnlyKeyboard());

      if (!categoryHasSubcategories(selected)) {
        delete s.subcategorySlug;
        delete s.subcategoryLabel;
        delete s.itemMetadata;
        botFlowStep(ctx.from?.id, "subcategory_skipped", { categoryCode: selected.code ?? selected.name });
        await ctx.reply(MSG_TITLE_STEP, cancelOnlyKeyboard());
        return ctx.wizard.selectStep(3);
      }

      if (selected.code === "olympiads" && categoryHasSubcategories(selected) && selected.subcategories.length === 1) {
        const only = selected.subcategories[0]!;
        s.subcategorySlug = only.slug;
        s.subcategoryLabel = (only.title ?? only.label).trim() || only.label;
        delete s.itemMetadata;
        botFlowStep(ctx.from?.id, "placement_prompt", { categoryCode: "olympiads", subcategorySlug: only.slug });
        await ctx.reply(
          "🥇 Pick your placement (1st, 2nd, or 3rd) using the buttons below.",
          olympiadPlacementKeyboard(),
        );
        return ctx.wizard.next();
      }

      await ctx.reply(MSG_SUBCATEGORY_PROMPT, subcategoryPickerKeyboard(selected.subcategories, { categoryCode: selected.code }));
      return ctx.wizard.next();
    },
    // 2 — subcategory (or olympiad placement)
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      const s = st(ctx);
      const categories = s.categories ?? [];
      const cat = categories.find((c) => c.id === s.categoryId);

      if (cat?.code === "olympiads" && s.subcategorySlug === "olympiad_participation") {
        if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data.startsWith("place_")) {
          await ctx.answerCbQuery();
          const placeNum = Number(ctx.callbackQuery.data.replace("place_", ""));
          if (![1, 2, 3].includes(placeNum)) {
            await ctx.reply("Invalid placement.");
            return;
          }
          s.itemMetadata = { place: placeNum };
          botFlowStep(ctx.from?.id, "placement_selected", { place: placeNum });
          await ctx.reply(MSG_TITLE_STEP, cancelOnlyKeyboard());
          return ctx.wizard.next();
        }

        if (
          !ctx.callbackQuery ||
          !("data" in ctx.callbackQuery) ||
          !ctx.callbackQuery.data.startsWith("sub_")
        ) {
          await ctx.reply("🥇 Tap 1st, 2nd, or 3rd place below.", olympiadPlacementKeyboard());
          return;
        }
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("👆 Please tap one of the type buttons below.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("sub_")) {
        await ctx.answerCbQuery();
        await ctx.reply("👆 Please use the type buttons for this category.");
        return;
      }

      const slug = data.replace("sub_", "");
      const sub = cat?.subcategories.find((x) => x.slug === slug);
      if (!sub) {
        await ctx.answerCbQuery();
        await ctx.reply("That type is not valid here. Tap a button from the list above.");
        return;
      }

      await ctx.answerCbQuery();
      s.subcategorySlug = sub.slug;
      s.subcategoryLabel = (sub.title ?? sub.label).trim() || sub.label;

      botFlowStep(ctx.from?.id, "subcategory_selected", { categoryCode: cat?.code ?? cat?.name, subcategorySlug: slug });

      if (cat?.code === "olympiads" && slug === "olympiad_participation") {
        delete s.itemMetadata;
        botFlowStep(ctx.from?.id, "placement_prompt", { categoryCode: "olympiads", subcategorySlug: slug });
        await ctx.reply("🥇 Pick your placement (1st, 2nd, or 3rd) below.", olympiadPlacementKeyboard());
        return;
      }

      await ctx.reply(MSG_TITLE_STEP, cancelOnlyKeyboard());
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
        await ctx.reply("Please send a short title (one line). See the examples above.");
        return;
      }

      st(ctx).title = ctx.message.text.trim();
      botFlowStep(ctx.from?.id, "title_entered", { titleLen: st(ctx).title!.length });
      await ctx.reply(MSG_DESCRIPTION_STEP, cancelOnlyKeyboard());
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
        await ctx.reply("Please add a short description (what, when, details).");
        return;
      }

      st(ctx).description = ctx.message.text.trim();
      botFlowStep(ctx.from?.id, "description_entered", { descriptionLen: st(ctx).description!.length });
      await ctx.reply(MSG_PROOF_STEP, cancelOnlyKeyboard());
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

      botFlowStep(ctx.from?.id, "file_uploaded", { mimeType });

      await ctx.reply(MSG_LINK_STEP, skipOptionalLinkKeyboard());
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
      try {
        await persistItemAndRecordPreview(ctx, upms, externalLink);
      } catch (e) {
        await ctx.reply(
          `❌ Could not save this line.\n\n${friendlyPersistenceError(e)}\n\nYou can fix the issue and try again.`,
          cancelOnlyKeyboard(),
        );
        return;
      }

      clearCurrentItem(s);
      await ctx.reply(
        "✅ Line saved.\n\n➕ Add another achievement, or tap Preview to check everything before submit.",
        addAnotherItemKeyboard(),
      );
      return ctx.wizard.next();
    },
    // 7 — add another vs preview
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("👆 Use the buttons below.");
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
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("👆 Use Submit or Cancel below.");
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
