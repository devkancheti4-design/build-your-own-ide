import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the built site works from any folder (or GitHub Pages).
  base: "./",
  // The level programs live in ../examples, outside this folder.
  server: { fs: { allow: [".."] } },
});
