import { defineConfig } from "@kubb/core";
import { isKeyword, pluginOas, type Schema } from "@kubb/plugin-oas";
import { pluginZod } from "@kubb/plugin-zod";

function preserveReferenceFields(node: Schema): Schema {
  return isKeyword(node, "ref")
    ? { keyword: "and", args: [node, { keyword: "unknown" }] }
    : node;
}

export default defineConfig({
  root: ".",
  input: {
    path: "./public/openapi/openapi.json",
  },
  output: {
    path: "./src/generated/kubb",
    clean: true,
  },
  plugins: [
    pluginOas({
      generators: [],
      discriminator: "inherit",
    }),
    pluginZod({
      output: {
        path: "./zod",
      },
      transformers: {
        // Kubb's old allOf wrappers preserved input fields. Keep that behavior for
        // documented property refs, without changing array refs or component roots.
        // Intersect with unknown to keep the referenced type's inference.
        schema({ schema, parentName }, defaults) {
          if (!schema?.description || parentName === null) return defaults;
          if ("$ref" in schema) return defaults.map(preserveReferenceFields);
          if (
            schema.anyOf?.length === 2 &&
            schema.anyOf.some((branch) => "$ref" in branch) &&
            schema.anyOf.some((branch) => branch.type === "null")
          ) {
            return defaults.map((node) =>
              isKeyword(node, "union")
                ? { ...node, args: node.args.map(preserveReferenceFields) }
                : node,
            );
          }
          return defaults;
        },
      },
    }),
  ],
});
