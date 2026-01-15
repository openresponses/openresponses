module.exports = {
  plugins: [
    "./node_modules/@typespec/prettier-plugin-typespec/dist/index.js",
    "prettier-plugin-astro",
    "prettier-plugin-tailwindcss",
  ],
  overrides: [{ files: "*.tsp", options: { parser: "typespec" } }],
};
