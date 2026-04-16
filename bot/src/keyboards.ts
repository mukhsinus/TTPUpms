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

function categoryButtonLabel(c: CategoryCatalogEntry): string {
  const t = c.title?.trim();
  return t || c.code.replace(/_/g, " ");
}

/** Two categories per row; callback cat_<uuid> — labels use human title from API. */
export function categoryPickerKeyboard(categories: CategoryCatalogEntry[]) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < categories.length; i += 2) {
    const row = [Markup.button.callback(categoryButtonLabel(categories[i]), `cat_${categories[i].id}`)];
    if (categories[i + 1]) {
      row.push(Markup.button.callback(categoryButtonLabel(categories[i + 1]), `cat_${categories[i + 1].id}`));
    }
    rows.push(row);
  }
  rows.push(CANCEL_ROW);
  return Markup.inlineKeyboard(rows);
}

function standardizedTestsSubButtonLabel(slug: string, fallback: string): string {
  if (slug === "high") return "SAT 1400+";
  if (slug === "mid") return "SAT 1300–1400";
  if (slug === "low") return "SAT 1200–1300";
  return fallback;
}

/** Callback sub_<slug> — category is already chosen in session */
export function subcategoryPickerKeyboard(
  subcategories: CategoryCatalogEntry["subcategories"],
  options?: { categoryCode?: string },
) {
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  const code = options?.categoryCode;
  function subButtonLabel(s: (typeof subcategories)[number]): string {
    const t = s.title?.trim();
    const lab = s.label?.trim();
    return t || lab || s.slug.replace(/_/g, " ");
  }

  for (let i = 0; i < subcategories.length; i += 2) {
    const a = subcategories[i];
    const humanA = subButtonLabel(a);
    const labelA =
      code === "standardized_tests" ? standardizedTestsSubButtonLabel(a.slug, humanA) : humanA;
    const row = [Markup.button.callback(labelA, `sub_${a.slug}`)];
    if (subcategories[i + 1]) {
      const b = subcategories[i + 1];
      const humanB = subButtonLabel(b);
      const labelB =
        code === "standardized_tests" ? standardizedTestsSubButtonLabel(b.slug, humanB) : humanB;
      row.push(Markup.button.callback(labelB, `sub_${b.slug}`));
    }
    rows.push(row);
  }
  rows.push(CANCEL_ROW);
  return Markup.inlineKeyboard(rows);
}

/** Callbacks place_1 | place_2 | place_3 */
export function olympiadPlacementKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("1st place", "place_1"),
      Markup.button.callback("2nd place", "place_2"),
      Markup.button.callback("3rd place", "place_3"),
    ],
    CANCEL_ROW,
  ]);
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
