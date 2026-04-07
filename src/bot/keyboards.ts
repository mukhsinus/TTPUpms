import { Markup } from "telegraf";

export const mainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Submit Achievement", "menu_submit")],
    [Markup.button.callback("View Submissions", "menu_submissions")],
    [Markup.button.callback("View Points", "menu_points")],
  ]);

export const categoryKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("Academic", "cat_Academic"),
      Markup.button.callback("Competition", "cat_Competition"),
    ],
    [
      Markup.button.callback("Research", "cat_Research"),
      Markup.button.callback("Organization", "cat_Organization"),
    ],
    [Markup.button.callback("Community Service", "cat_Community Service")],
    [Markup.button.callback("Cancel", "wizard_cancel")],
  ]);

export const confirmKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("Confirm Submit", "confirm_submit"),
      Markup.button.callback("Cancel", "wizard_cancel"),
    ],
  ]);
