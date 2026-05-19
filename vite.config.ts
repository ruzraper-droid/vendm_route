import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const rawPort = process.env.FRONTEND_PORT || process.env.PORT || "5173";
const port = Number(rawPort);
const backendRawPort = process.env.SERVER_PORT || "5174";
const backendPort = Number(backendRawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

if (Number.isNaN(backendPort) || backendPort <= 0) {
  throw new Error(`Invalid SERVER_PORT value: "${backendRawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) return "vendor-react"
            if (id.includes("qr-scanner")) return "vendor-qr-scanner"
            if (id.includes("recharts")) return "vendor-recharts"
            return "vendor"
          }
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
