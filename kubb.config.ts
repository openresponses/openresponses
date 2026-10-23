import { defineConfig } from "@kubb/core";
import { isKeyword, pluginOas, type Schema } from "@kubb/plugin-oas";
import { pluginZod, type PluginZod } from "@kubb/plugin-zod";

function preserveReferenceFields(node: Schema): Schema {
  return isKeyword(node, "ref")
    ? { keyword: "and", args: [node, { keyword: "unknown" }] }
    : node;
}

// Kubb 4.15 omits closed-object checks, union bounds, and required unknown values.
// Apply these checks only to steering schemas, preserving existing validators.
const preserveSteeringConstraints: NonNullable<
  PluginZod["options"]["wrapOutput"]
> = ({ output, schema }) => {
  if (!schema) return output;
  if (schema.additionalProperties === false) output += ".strict()";

  const branches = schema.oneOf ?? schema.anyOf ?? [];
  const hasType = (branch: unknown, type: string) =>
    typeof branch === "object" &&
    branch !== null &&
    "type" in branch &&
    branch.type === type;
  const text = branches.find((branch) => hasType(branch, "string"));
  if (
    typeof text === "object" &&
    text !== null &&
    "maxLength" in text &&
    typeof text.maxLength === "number"
  ) {
    output += `.refine(value => typeof value !== "string" || value.length <= ${text.maxLength} || Array.from(value).length <= ${text.maxLength}, { message: "Text exceeds the maximum length" })`;
  }
  if (
    schema.minItems !== undefined &&
    branches.some((branch) => hasType(branch, "array"))
  ) {
    output += `.refine(value => !Array.isArray(value) || value.length >= ${schema.minItems}, { message: "Too few input messages" })`;
  }

  for (const name of Array.isArray(schema.required) ? schema.required : []) {
    const property = schema.properties?.[name];
    if (
      property &&
      Object.keys(property).every(
        (key) => key === "description" || key.startsWith("x-"),
      )
    ) {
      const key = JSON.stringify(name);
      output += `.refine(value => value[${key}] !== undefined, { path: [${key}], message: "Required" })`;
    }
  }
  return output;
};

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
      override: [
        {
          type: "schemaName",
          pattern: /^WebSocket(?:ResponseSteer|Steering)/,
          options: { wrapOutput: preserveSteeringConstraints },
        },
      ],
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
