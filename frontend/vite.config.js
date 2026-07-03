/* eslint-disable no-undef */
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const frontendRoot = path.resolve(__dirname);
  const env = loadEnv(mode, frontendRoot, "");
  const apiTarget = env.VITE_API_URL || "http://localhost:4000";

  return {
    envDir: frontendRoot,
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});