import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enDashboard from "../locales/en/dashboard.json";
import enProfile from "../locales/en/profile.json";
import enSubmissions from "../locales/en/submissions.json";
import ruDashboard from "../locales/ru/dashboard.json";
import ruProfile from "../locales/ru/profile.json";
import ruSubmissions from "../locales/ru/submissions.json";
import uzDashboard from "../locales/uz/dashboard.json";
import uzProfile from "../locales/uz/profile.json";
import uzSubmissions from "../locales/uz/submissions.json";
import type { AppLocale } from "./constants";
import { LOCALE_STORAGE_KEY } from "./constants";
import { getInitialLocale } from "./detect-locale";

const resources = {
  en: {
    dashboard: enDashboard as Record<string, string>,
    submissions: enSubmissions as Record<string, string>,
    profile: enProfile as Record<string, string>,
  },
  ru: {
    dashboard: ruDashboard as Record<string, string>,
    submissions: ruSubmissions as Record<string, string>,
    profile: ruProfile as Record<string, string>,
  },
  uz: {
    dashboard: uzDashboard as Record<string, string>,
    submissions: uzSubmissions as Record<string, string>,
    profile: uzProfile as Record<string, string>,
  },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLocale(),
  fallbackLng: "en",
  ns: ["dashboard", "submissions", "profile"],
  defaultNS: "dashboard",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
}

i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
});

export function persistAndChangeLanguage(lng: AppLocale): ReturnType<typeof i18n.changeLanguage> {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  return i18n.changeLanguage(lng);
}

export default i18n;
