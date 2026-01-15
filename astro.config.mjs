import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

import mdx from "@astrojs/mdx";

import expressiveCode from "astro-expressive-code";
import mermaid from "astro-mermaid";

export default defineConfig({
  output: "static",
  integrations: [
    react(),
    expressiveCode({ themes: ["dark-plus"] }),
    mdx(),
    mermaid({
      autoTheme: true,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
