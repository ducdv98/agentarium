import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { themeAssets } from "./vite-plugin-theme-assets";

export default defineConfig({ plugins: [react(), themeAssets()], build: { outDir: "dist" } });
