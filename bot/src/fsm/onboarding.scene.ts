import { Markup, Scenes } from "telegraf";
import { cancelOnlyKeyboard, degreePickerKeyboard, mainMenuKeyboard, phoneRequestKeyboard } from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext } from "../types/session";
import { normalizeStudentId } from "../utils/student-id";
import { userFacingUpmsMessage } from "../utils/upms-user-facing";

interface OnboardingState {
  fullName?: string;
  phone?: string;
  degree?: "bachelor" | "master";
  faculty?: string;
}

function ob(ctx: BotContext): OnboardingState {
  return ctx.wizard.state as OnboardingState;
}

async function leaveWithMenu(ctx: BotContext): Promise<void> {
  await ctx.scene.leave();
}

function normalizePhoneInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const hasLeadingPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length < 9 || digitsOnly.length > 15) {
    return null;
  }
  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

export function createStudentOnboardingScene(upms: UpmsService): Scenes.WizardScene<BotContext> {
  return new Scenes.WizardScene<BotContext>(
    "student-onboarding",
    // 0 — collect full name (also handles entering from /start on the same update)
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Profile setup cancelled. Use /start when you are ready to continue.");
        await leaveWithMenu(ctx);
        return;
      }

      if (ctx.message && "text" in ctx.message) {
        const raw = ctx.message.text.trim();
        if (raw.startsWith("/")) {
          await ctx.reply("Enter your full name (First Name Last Name):", cancelOnlyKeyboard());
          return;
        }
        if (!raw) {
          await ctx.reply("Please send your full name as text.");
          return;
        }
        if (raw.length > 300) {
          await ctx.reply("That name is too long. Please shorten it.");
          return;
        }
        ob(ctx).fullName = raw;
        await ctx.reply(
          "Send your phone number.\n\nUse the button below to share automatically, or type it manually.",
          phoneRequestKeyboard(),
        );
        return ctx.wizard.next();
      }

      await ctx.reply("Enter your full name (First Name Last Name):", cancelOnlyKeyboard());
    },
    // 1 — phone (contact button or manual text)
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Profile setup cancelled. Use /start when you are ready to continue.");
        await leaveWithMenu(ctx);
        return;
      }

      let normalizedPhone: string | null = null;
      if (ctx.message && "contact" in ctx.message && ctx.message.contact) {
        const ownerId = ctx.message.contact.user_id;
        if (ownerId && ownerId !== ctx.from?.id) {
          await ctx.reply("Please share your own phone number, not someone else's.");
          return;
        }
        normalizedPhone = normalizePhoneInput(ctx.message.contact.phone_number);
      } else if (ctx.message && "text" in ctx.message && ctx.message.text.trim()) {
        normalizedPhone = normalizePhoneInput(ctx.message.text);
      }

      if (!normalizedPhone) {
        await ctx.reply(
          "Please send a valid phone number (9-15 digits), or use the contact button below.",
          phoneRequestKeyboard(),
        );
        return;
      }

      ob(ctx).phone = normalizedPhone;
      await ctx.reply("Phone number saved.", Markup.removeKeyboard());
      await ctx.reply("Select your degree:", degreePickerKeyboard());
      return ctx.wizard.next();
    },
    // 2 — degree (callbacks only)
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Profile setup cancelled. Use /start when you are ready to continue.");
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please choose Bachelor or Master using the buttons.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (data !== "deg_bachelor" && data !== "deg_master") {
        await ctx.answerCbQuery();
        await ctx.reply("Please use the degree buttons.");
        return;
      }
      await ctx.answerCbQuery();
      ob(ctx).degree = data === "deg_bachelor" ? "bachelor" : "master";
      await ctx.reply("Enter your faculty (for example, BBM):", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 3 — faculty
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Profile setup cancelled. Use /start when you are ready to continue.");
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send your faculty name as text.");
        return;
      }

      const faculty = ctx.message.text.trim();
      if (faculty.length > 200) {
        await ctx.reply("That faculty label is too long. Try a shorter abbreviation.");
        return;
      }

      ob(ctx).faculty = faculty;
      await ctx.reply("Enter your student ID:", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 4 — student ID + persist
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Profile setup cancelled. Use /start when you are ready to continue.");
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send your student ID as text.");
        return;
      }

      const studentId = normalizeStudentId(ctx.message.text);
      if (studentId.length > 64) {
        await ctx.reply("That student ID is too long. Check your ID and try again.");
        return;
      }

      const s = ob(ctx);
      const fullName = s.fullName;
      const phone = s.phone;
      const degree = s.degree;
      const faculty = s.faculty;
      if (!fullName || !phone || !degree || !faculty) {
        await ctx.reply("Session was reset. Please use /start again.");
        await leaveWithMenu(ctx);
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      if (!tgId) {
        await ctx.reply("Session error. Use /start to link again.");
        await leaveWithMenu(ctx);
        return;
      }

      try {
        await upms.completeStudentProfile({
          telegramId: tgId,
          studentFullName: fullName,
          phone,
          degree,
          faculty,
          studentId,
        });
      } catch (error) {
        await ctx.reply(userFacingUpmsMessage(error, "Could not save your profile. Please try again."), cancelOnlyKeyboard());
        return;
      }

      ctx.session.profileComplete = true;
      await ctx.reply(
        `Thank you. Your profile is complete.\n\nWelcome, ${fullName}.\nUse the menu to submit achievements or check your submissions.`,
        mainMenuKeyboard(),
      );
      await leaveWithMenu(ctx);
    },
  );
}
