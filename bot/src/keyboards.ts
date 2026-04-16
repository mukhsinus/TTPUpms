import { Markup } from "telegraf";
import type { CategoryCatalogEntry } from "./types/session";

const CANCEL_ROW = [Markup.button.callback("Cancel", "wizard_cancel")];

export const mainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Submit Achievement", "menu_submit")],
    [Markup.button.callback("My Submissions", "menu_submissions")],
    [Markup.button.callback("My Points", "menu_points")],
    [Markup.button.callback("Help", "menu_help")],
  ]);

export function degreePickerKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Bachelor", "deg_bachelor"),
      Markup.button.callback("Master", "deg_master"),
    ],
    CANCEL_ROW,
  ]);
}

/** Two categories per row; callback cat_<uuid> */
export function categoryPickerKeyboard(categories: CategoryCatalogEntry[]) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < categories.length; i += 2) {
    const row = [Markup.button.callback(categories[i].name, `cat_${categories[i].id}`)];
    if (categories[i + 1]) {
      row.push(Markup.button.callback(categories[i + 1].name, `cat_${categories[i + 1].id}`));
    }
    rows.push(row);
  }
  rows.push(CANCEL_ROW);
  return Markup.inlineKeyboard(rows);
}

/** Callback sub_<slug> — category is already chosen in session */
export function subcategoryPickerKeyboard(subcategories: Array<{ slug: string; label: string }>) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < subcategories.length; i += 2) {
    const row = [Markup.button.callback(subcategories[i].label, `sub_${subcategories[i].slug}`)];
    if (subcategories[i + 1]) {
      row.push(
        Markup.button.callback(subcategories[i + 1].label, `sub_${subcategories[i + 1].slug}`),
      );
    }
    rows.push(row);
  }
  rows.push(CANCEL_ROW);
  return Markup.inlineKeyboard(rows);
}

export const cancelOnlyKeyboard = () => Markup.inlineKeyboard([CANCEL_ROW]);

export const skipOptionalLinkKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Skip", "skip_external_link")],
    CANCEL_ROW,
  ]);

export const addAnotherItemKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Add another item", "flow_add_more")],
    [Markup.button.callback("Preview and submit", "flow_preview")],
    CANCEL_ROW,
  ]);

export const previewSubmitKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Submit", "confirm_submit"), Markup.button.callback("Cancel", "wizard_cancel")],
  ]);
