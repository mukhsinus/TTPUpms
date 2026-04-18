import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    if (id.includes("node_modules/react-dom/") || id.includes("node_modules/react/")) {
                        return "react-vendor";
                    }
                    if (id.includes("node_modules/react-router")) {
                        return "router";
                    }
                    if (id.includes("node_modules/lucide-react")) {
                        return "lucide";
                    }
                    if (id.includes("node_modules/recharts")) {
                        return "recharts";
                    }
                    if (id.includes("node_modules/@supabase")) {
                        return "supabase";
                    }
                },
            },
        },
    },
});
