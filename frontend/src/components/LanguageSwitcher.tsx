import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { AppLocale } from "../i18n/constants";
import { persistAndChangeLanguage } from "../i18n";

const OPTIONS: readonly { code: AppLocale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "uz", label: "O'zbek" },
] as const;

function currentLabel(code: string): string {
  const row = OPTIONS.find((o) => o.code === code);
  return row?.label ?? "English";
}

export function LanguageSwitcher(): ReactElement {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (ev: PointerEvent): void => {
      if (!rootRef.current?.contains(ev.target as Node)) {
        close();
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        close();
      }
    };
    globalThis.addEventListener("pointerdown", onPointerDown);
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("pointerdown", onPointerDown);
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  const active = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0] as AppLocale;
  const safeCode: AppLocale = active === "ru" || active === "uz" ? active : "en";

  const select = (lng: AppLocale): void => {
    void persistAndChangeLanguage(lng);
    close();
  };

  return (
    <div className="language-switcher" ref={rootRef}>
      <button
        type="button"
        className="language-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${currentLabel(safeCode)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="language-switcher-globe" aria-hidden>
          🌐
        </span>
        <span className="language-switcher-code">{safeCode.toUpperCase()}</span>
        <ChevronDown size={16} className="language-switcher-chevron" aria-hidden />
      </button>
      {open ? (
        <ul className="language-switcher-menu" role="listbox">
          {OPTIONS.map((opt) => (
            <li key={opt.code} role="none">
              <button
                type="button"
                role="option"
                aria-selected={opt.code === safeCode}
                className={`language-switcher-option${opt.code === safeCode ? " is-active" : ""}`}
                onClick={() => select(opt.code)}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
