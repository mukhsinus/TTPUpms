import type { AppLocale } from "./constants";
import { isAppLocale, LOCALE_STORAGE_KEY } from "./constants";

function readStoredLocale(): AppLocale | null {
  try {
    const raw = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(raw)) {
      return raw;
    }
  } catch {
    // private mode / blocked storage
  }
  return null;
}

function detectNavigatorLocale(): AppLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const tag = navigator.language?.toLowerCase() ?? "en";
  if (tag.startsWith("ru")) {
    return "ru";
  }
  if (tag.startsWith("uz")) {
    return "uz";
  }
  return "en";
}

/** Priority: localStorage → browser locale (ru/uz/en). */
export function getInitialLocale(): AppLocale {
  return readStoredLocale() ?? detectNavigatorLocale();
}
