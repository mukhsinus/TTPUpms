import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./contexts/ToastContext";
import "./i18n";
import "./styles.css";

const CHUNK_RECOVERY_KEY = "chunk-recovery-reloaded-at";
const CHUNK_RECOVERY_WINDOW_MS = 15_000;

function tryRecoverFromStaleChunk(): void {
  const now = Date.now();
  const previous = Number(window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) ?? "0");
  if (Number.isFinite(previous) && now - previous < CHUNK_RECOVERY_WINDOW_MS) {
    return;
  }
  window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(now));
  window.location.reload();
}

window.addEventListener("vite:preloadError", (event) => {
  // Recover from stale chunk references after a fresh deployment.
  event.preventDefault();
  tryRecoverFromStaleChunk();
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  if (
    /Importing a module script failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message)
  ) {
    event.preventDefault();
    tryRecoverFromStaleChunk();
  }
});

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>,
);
