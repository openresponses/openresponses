import type { OpenApiDocument, OpenApiSchema } from "./types";
import { derefSchema, isRef, refName } from "./resolve";

export type SchemaUnionInfo = {
  kind: "oneOf" | "anyOf";
  variants: OpenApiSchema[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
};

export function splitNullableUnion(schema: OpenApiSchema): {
  base: OpenApiSchema;
  nullable: boolean;
} {
  const anyOf = schema.anyOf;
  if (!anyOf || anyOf.length < 2) return { base: schema, nullable: false };

  const nonNull = anyOf.filter((s) => s?.type !== "null");
  const hasNull = nonNull.length !== anyOf.length;
  if (!hasNull) return { base: schema, nullable: false };

  // Prefer the single "real" schema if it's a simple nullable union; otherwise keep the union.
  if (nonNull.length === 1) return { base: nonNull[0], nullable: true };
  return { base: { ...schema, anyOf: nonNull }, nullable: true };
}

export function getUnionInfo(schema: OpenApiSchema): SchemaUnionInfo | null {
  if (schema.oneOf?.length) {
    return {
      kind: "oneOf",
      variants: schema.oneOf,
      discriminator: schema.discriminator,
    };
  }
  if (schema.anyOf?.length) {
    // Note: nullable unions are handled separately; this returns "anyOf" as a union.
    return {
      kind: "anyOf",
      variants: schema.anyOf,
      discriminator: schema.discriminator,
    };
  }
  return null;
}

export function schemaIsEffectivelyEmptyObject(schema: OpenApiSchema): boolean {
  return (
    schema.type === "object" &&
    !schema.properties &&
    schema.additionalProperties === undefined
  );
}

export function schemaTypeLabel(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
): string {
  const { base, nullable } = splitNullableUnion(schema);
  const s = derefSchema(doc, base);

  const union = getUnionInfo(s);
  if (union) return "union";

  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum?.length) return "enum";

  if (isRef(s) && s.$ref) return refName(s.$ref) ?? "ref";

  // Some generated schemas omit `type` but still provide `items`/`properties`.
  if (s.type === "array" || (s.type === undefined && (s as any).items)) {
    const items = s.items ? schemaTypeLabel(doc, s.items) : "unknown";
    return `${items}[]`;
  }

  if (s.type === "object" || (s.type === undefined && (s as any).properties)) {
    if (schemaIsEffectivelyEmptyObject(s)) return "object";
    return "object";
  }

  if (typeof s.type === "string") {
    // Keep string-ish types short; formats can be shown as a badge.
    return s.type;
  }

  // JSON Schema can omit "type" and specify via keywords; keep it neutral.
  return "unknown";
}

export function schemaShortRef(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
): string | null {
  const s = derefSchema(doc, schema);
  if (isRef(s) && s.$ref) return refName(s.$ref);
  if (schema.$ref) return refName(schema.$ref);
  return null;
}

export function schemaDisplayTitle(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
): string | null {
  const s = derefSchema(doc, schema);
  const rn = schemaShortRef(doc, schema);
  if (rn) return rn;
  if (s.title) return s.title;
  return null;
}

export function inferDiscriminatorValue(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
  discriminatorProp: string,
): string | null {
  const s = derefSchema(doc, schema);
  const props = s.properties;
  if (!props) return null;
  const dp = props[discriminatorProp];
  if (!dp) return null;

  const dpResolved = derefSchema(doc, dp);
  if (dpResolved.const !== undefined) return String(dpResolved.const);
  if (dpResolved.enum?.length === 1) return String(dpResolved.enum[0]);
  return null;
}

export function unionVariantLabels(
  doc: OpenApiDocument,
  union: SchemaUnionInfo,
): string[] {
  const disc = union.discriminator?.propertyName;
  if (!disc) {
    return union.variants.map(
      (v) => schemaDisplayTitle(doc, v) ?? schemaTypeLabel(doc, v) ?? "variant",
    );
  }

  // Prefer explicit mapping keys, when present.
  const mappingKeys = union.discriminator?.mapping
    ? Object.keys(union.discriminator.mapping)
    : [];
  if (mappingKeys.length) return mappingKeys;

  // Otherwise, infer from each variant's discriminator property.
  return union.variants.map(
    (v) =>
      inferDiscriminatorValue(doc, v, disc) ??
      schemaDisplayTitle(doc, v) ??
      "variant",
  );
}

export function tryGetObjectProperties(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
): {
  properties: Record<string, OpenApiSchema>;
  required: Set<string>;
} | null {
  const s = derefSchema(doc, schema);
  if (s.type !== "object") return null;
  const properties = s.properties ?? {};
  const required = new Set<string>(s.required ?? []);
  return { properties, required };
}
