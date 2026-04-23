import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./contexts/ToastContext";
import "./i18n";
import "./styles.css";

window.addEventListener("vite:preloadError", (event) => {
  // Recover from stale chunk references after a fresh deployment.
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>,
);
