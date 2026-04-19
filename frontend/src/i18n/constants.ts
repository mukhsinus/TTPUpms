export const LOCALE_STORAGE_KEY = "ttpupms.ui.language";

export const SUPPORTED_LOCALES = ["en", "ru", "uz"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "ru" || value === "uz";
}
