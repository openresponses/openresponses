import type { OpenApiDocument, OpenApiSchema } from "./types";

type EnumValue = string | number | boolean | null;

export type OpenApiSchemaExt = OpenApiSchema & {
  "x-inlineable"?: boolean;
  "x-unionDisplay"?: "inline" | "section";
  "x-unionTitle"?: string;
  "x-enumDescriptions"?: Record<string, string>;
};

export type EnumDescriptions = Record<string, string>;

const getSchemaFromRef = (doc: OpenApiDocument, ref: string) => {
  const refName = ref.split("/").pop();
  if (!refName) return null;
  return (doc.components?.schemas?.[refName] ??
    null) as OpenApiSchemaExt | null;
};

export const resolveRef = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): OpenApiSchemaExt | null => {
  if (!schema) return null;
  if (!schema.$ref) return schema;
  return getSchemaFromRef(doc, schema.$ref) ?? schema;
};

export const getRefName = (schema?: OpenApiSchemaExt | null) =>
  schema?.$ref?.split("/").pop() ?? null;

export const getDescription = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): string => {
  if (!schema) return "";
  if (schema.description) return schema.description;
  if (schema.allOf?.[1]?.description) return schema.allOf[1].description ?? "";
  if (schema.$ref) {
    const resolved = resolveRef(doc, schema);
    if (resolved && resolved !== schema) return getDescription(doc, resolved);
  }
  const variants = schema.anyOf || schema.oneOf || schema.allOf;
  if (Array.isArray(variants)) {
    for (const item of variants) {
      const desc = getDescription(doc, item as OpenApiSchemaExt);
      if (desc) return desc;
    }
  }
  return "";
};

export const getTypeLabel = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): string => {
  if (!schema) return "unknown";
  if (schema.$ref) return getRefName(schema) || "unknown";
  if (schema.properties || schema.additionalProperties) return "object";
  if (schema.items) return getTypeLabel(doc, schema.items as OpenApiSchemaExt);
  if (schema.type) return schema.type;

  if (schema.allOf) {
    const refItem = schema.allOf.find((item) => item.$ref) as
      | OpenApiSchemaExt
      | undefined;
    if (refItem) return getRefName(refItem) || "object";
  }
  if (schema.anyOf) {
    const nonNull = schema.anyOf.find((item) => item.type !== "null") as
      | OpenApiSchemaExt
      | undefined;
    return getTypeLabel(doc, nonNull) || "unknown";
  }
  if (schema.oneOf) {
    const first = schema.oneOf[0] as OpenApiSchemaExt | undefined;
    return getTypeLabel(doc, first) || "unknown";
  }
  return "unknown";
};

export const getUnionVariants = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): OpenApiSchemaExt[] => {
  if (!schema) return [];
  if (schema.$ref) {
    const resolved = resolveRef(doc, schema);
    if (resolved && resolved !== schema) return getUnionVariants(doc, resolved);
  }

  const variants = schema.anyOf || schema.oneOf;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((item) => item?.type !== "null");
    const flattened: OpenApiSchemaExt[] = [];
    for (const item of nonNull) {
      const nested = getUnionVariants(doc, item as OpenApiSchemaExt);
      if (nested.length > 0) {
        flattened.push(...nested);
      } else {
        flattened.push(item as OpenApiSchemaExt);
      }
    }
    return flattened;
  }

  return [];
};

export const getInlineable = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): boolean => {
  if (!schema) return false;
  if (schema["x-inlineable"] === true) return true;
  if (schema.$ref) return getInlineable(doc, resolveRef(doc, schema));
  const variants = schema.anyOf || schema.oneOf || schema.allOf;
  if (Array.isArray(variants)) {
    return variants.some((item) =>
      getInlineable(doc, item as OpenApiSchemaExt),
    );
  }
  return false;
};

export const getUnionDisplay = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): "inline" | "section" | null => {
  if (!schema) return null;
  if (schema["x-unionDisplay"]) return schema["x-unionDisplay"];
  if (schema.$ref) return getUnionDisplay(doc, resolveRef(doc, schema));
  const variants = schema.anyOf || schema.oneOf;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((item) => item?.type !== "null");
    for (const item of nonNull) {
      const display = getUnionDisplay(doc, item as OpenApiSchemaExt);
      if (display) return display;
    }
  }
  return null;
};

export const getUnionTitle = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): string | null => {
  if (!schema) return null;
  if (schema["x-unionTitle"]) return schema["x-unionTitle"];
  if (schema.$ref) return getUnionTitle(doc, resolveRef(doc, schema));
  const variants = schema.anyOf || schema.oneOf;
  if (Array.isArray(variants)) {
    const nonNull = variants.filter((item) => item?.type !== "null");
    for (const item of nonNull) {
      const title = getUnionTitle(doc, item as OpenApiSchemaExt);
      if (title) return title;
    }
  }
  return null;
};

export const getSchemaProperties = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): Record<string, OpenApiSchemaExt> | null => {
  if (!schema) return null;
  if (schema.$ref) return getSchemaProperties(doc, resolveRef(doc, schema));
  if (schema.type === "object" && schema.properties) {
    return schema.properties as Record<string, OpenApiSchemaExt>;
  }
  if (schema.type === "array" && schema.items) {
    return getSchemaProperties(doc, schema.items as OpenApiSchemaExt);
  }
  if (schema.allOf) {
    for (const item of schema.allOf) {
      const props = getSchemaProperties(doc, item as OpenApiSchemaExt);
      if (props) return props;
    }
  }
  if (schema.anyOf) {
    for (const item of schema.anyOf) {
      const props = getSchemaProperties(doc, item as OpenApiSchemaExt);
      if (props) return props;
    }
  }
  if (schema.oneOf) {
    for (const item of schema.oneOf) {
      const props = getSchemaProperties(doc, item as OpenApiSchemaExt);
      if (props) return props;
    }
  }
  return null;
};

export const getSchemaRequired = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): string[] => {
  if (!schema) return [];
  if (schema.$ref) return getSchemaRequired(doc, resolveRef(doc, schema));
  if (schema.type === "object") return schema.required ?? [];
  if (schema.type === "array" && schema.items) {
    return getSchemaRequired(doc, schema.items as OpenApiSchemaExt);
  }
  if (schema.allOf) {
    for (const item of schema.allOf) {
      const req = getSchemaRequired(doc, item as OpenApiSchemaExt);
      if (req.length) return req;
    }
  }
  if (schema.anyOf) {
    for (const item of schema.anyOf) {
      const req = getSchemaRequired(doc, item as OpenApiSchemaExt);
      if (req.length) return req;
    }
  }
  if (schema.oneOf) {
    for (const item of schema.oneOf) {
      const req = getSchemaRequired(doc, item as OpenApiSchemaExt);
      if (req.length) return req;
    }
  }
  return [];
};

const PRIMITIVE_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

export const isSchemaComplex = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): boolean => {
  if (!schema) return false;
  if (schema.$ref) return isSchemaComplex(doc, resolveRef(doc, schema));
  if (schema.anyOf || schema.oneOf || schema.allOf) return true;
  if (schema.type === "array") {
    return isSchemaComplex(doc, schema.items as OpenApiSchemaExt);
  }
  if (schema.type === "object") return true;
  if (schema.properties) return true;
  if (schema.type && PRIMITIVE_TYPES.has(schema.type)) return false;
  return Boolean(schema.items);
};

export const isArraySchema = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): boolean => {
  if (!schema) return false;
  if (schema.$ref) return isArraySchema(doc, resolveRef(doc, schema));
  if (schema.type === "array" || schema.items) return true;
  const variants = schema.anyOf || schema.oneOf || schema.allOf;
  if (Array.isArray(variants)) {
    return variants.some((item) =>
      isArraySchema(doc, item as OpenApiSchemaExt),
    );
  }
  return false;
};

export const getEnumValues = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): EnumValue[] => {
  if (!schema) return [];
  if (schema.$ref) return getEnumValues(doc, resolveRef(doc, schema));
  if (schema.type === "array" && schema.items) {
    return getEnumValues(doc, schema.items as OpenApiSchemaExt);
  }
  if (Array.isArray(schema.enum)) return schema.enum as EnumValue[];
  const variants = schema.anyOf || schema.oneOf || schema.allOf;
  if (Array.isArray(variants)) {
    const values: EnumValue[] = [];
    for (const item of variants) {
      const itemValues = getEnumValues(doc, item as OpenApiSchemaExt);
      for (const value of itemValues) {
        if (!values.includes(value)) values.push(value);
      }
    }
    return values;
  }
  return [];
};

export const getEnumDescriptions = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): EnumDescriptions => {
  if (!schema) return {};
  if (schema.$ref) return getEnumDescriptions(doc, resolveRef(doc, schema));
  if (schema.type === "array" && schema.items) {
    return getEnumDescriptions(doc, schema.items as OpenApiSchemaExt);
  }
  if (
    schema["x-enumDescriptions"] &&
    typeof schema["x-enumDescriptions"] === "object"
  ) {
    return schema["x-enumDescriptions"] as EnumDescriptions;
  }
  const variants = schema.anyOf || schema.oneOf || schema.allOf;
  if (Array.isArray(variants)) {
    for (const item of variants) {
      const desc = getEnumDescriptions(doc, item as OpenApiSchemaExt);
      if (desc && Object.keys(desc).length > 0) return desc;
    }
  }
  return {};
};

export const getSectionMeta = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
) => {
  if (!schema) return null;
  if (schema.$ref) {
    const refName = getRefName(schema);
    const resolved = resolveRef(doc, schema);
    const display = resolved?.["x-unionDisplay"];
    if (display === "section" && refName) {
      return {
        id: `union-${refName}`,
        title: resolved?.["x-unionTitle"] || refName,
        schema: resolved,
        refName,
      };
    }
  }

  if (schema.type === "array" && schema.items?.$ref) {
    return getSectionMeta(doc, schema.items as OpenApiSchemaExt);
  }

  if (schema.allOf) {
    const refItem = schema.allOf.find((item) => item.$ref) as
      | OpenApiSchemaExt
      | undefined;
    if (refItem) return getSectionMeta(doc, refItem);
  }

  return null;
};
