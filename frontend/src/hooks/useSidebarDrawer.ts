import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";

/** Must match `styles.css` mobile sidebar breakpoint. */
export const SIDEBAR_DRAWER_MEDIA = "(max-width: 900px)";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useSidebarDrawer(open: boolean, onClose: () => void): {
  isMobileDrawer: boolean;
  asideRef: RefObject<HTMLElement | null>;
  close: () => void;
  touchHandlers: {
    onTouchStart: (e: ReactTouchEvent) => void;
    onTouchEnd: (e: ReactTouchEvent) => void;
  };
} {
  const asideRef = useRef<HTMLElement | null>(null);
  const [isMobileDrawer, setIsMobileDrawer] = useState(false);
  const touchStartX = useRef(0);
  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const mq = window.matchMedia(SIDEBAR_DRAWER_MEDIA);
    const sync = (): void => {
      setIsMobileDrawer(mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isMobileDrawer || !open) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobileDrawer, open, close]);

  useEffect(() => {
    if (!isMobileDrawer || !open) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileDrawer, open]);

  useEffect(() => {
    if (!isMobileDrawer || !open || !asideRef.current) {
      return;
    }
    const root = asideRef.current;
    const getFocusable = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
        if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") {
          return false;
        }
        const style = globalThis.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
      });

    const previouslyFocused = document.activeElement as HTMLElement | null;

    window.requestAnimationFrame(() => {
      const list = getFocusable();
      list[0]?.focus();
    });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") {
        return;
      }
      const list = getFocusable();
      if (list.length === 0) {
        return;
      }
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          list[list.length - 1]?.focus();
        }
      } else if (idx === list.length - 1 || idx === -1) {
        e.preventDefault();
        list[0]?.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isMobileDrawer, open]);

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? 0;
  }, []);

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      const endX = e.changedTouches[0]?.clientX ?? 0;
      if (touchStartX.current - endX > 56) {
        close();
      }
    },
    [close],
  );

  return {
    isMobileDrawer,
    asideRef,
    close,
    touchHandlers: { onTouchStart, onTouchEnd },
  };
}
