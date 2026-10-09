import type { OpenApiDocument, OpenApiSchema } from "./types";
import type { EnumDescriptions, OpenApiSchemaExt } from "./schema";
import {
  getDescription,
  getAddedIn,
  getEnumDescriptions,
  getEnumValues,
  getInlineable,
  getRefName,
  getSchemaProperties,
  getSchemaRequired,
  getTypeLabel,
  getTypeSummary,
  getUnionTitle,
  getUnionVariants,
  isArraySchema,
  isSchemaComplex,
  resolveRef,
} from "./schema";

export type EnumValue = string | number | boolean | null;

export type InlineRow = {
  name: string;
  typeSummary: string;
  description: string;
  required: boolean;
  enumValues: EnumValue[];
  enumDescriptions: EnumDescriptions;
  literalValue: string | null;
  unionVariants: ParameterUnionVariant[];
  addedIn: string | null;
};

export type ParameterUnionVariant = {
  label: string;
  array: boolean;
  sectionId: string | null;
  groupVariants?: ParameterUnionVariant[];
};

export type ParameterRow = {
  name: string;
  typeSummary: string;
  description: string;
  required: boolean;
  enumValues: EnumValue[];
  enumDescriptions: EnumDescriptions;
  literalValue: string | null;
  inlineable: boolean;
  inlineRows: InlineRow[];
  isUnion: boolean;
  unionVariants: ParameterUnionVariant[];
  typeLinkId: string | null;
  addedIn: string | null;
};

export type SectionKind = "enum" | "union" | "object";

export type EnumSection = {
  kind: "enum";
  id: string;
  name: string;
  title: string;
  description: string;
  values: EnumValue[];
  descriptions: EnumDescriptions;
  addedIn: string | null;
};

export type ObjectSection = {
  kind: "object";
  id: string;
  name: string;
  title: string;
  description: string;
  rows: InlineRow[];
  addedIn: string | null;
};

export type UnionVariantLink = {
  label: string;
  array: boolean;
  sectionId: string | null;
  groupVariants?: UnionVariantLink[];
};

export type UnionSection = {
  kind: "union";
  id: string;
  name: string;
  title: string;
  description: string;
  variants: UnionVariantLink[];
  addedIn: string | null;
};

export type ReferenceSections = {
  enums: EnumSection[];
  objects: ObjectSection[];
  unions: UnionSection[];
  byName: Map<string, { id: string; kind: SectionKind }>;
};

export type ReferenceIndex = {
  parameterRows: ParameterRow[];
  sections: ReferenceSections;
};

const buildInlineRows = (
  doc: OpenApiDocument,
  schema: OpenApiSchemaExt | null | undefined,
  sections: ReferenceSections,
): InlineRow[] => {
  const properties = getSchemaProperties(doc, schema);
  if (!properties) return [];
  const requiredSet = new Set(getSchemaRequired(doc, schema));

  return Object.entries(properties).map(([name, prop]) => {
    const enumValues = getEnumValues(doc, prop);
    const enumDescriptions = getEnumDescriptions(doc, prop);
    const literalValue = enumValues.length === 1 ? String(enumValues[0]) : null;

    const unionVariants = buildUnionVariants(doc, prop, sections);

    return {
      name,
      typeSummary: getTypeSummary(doc, prop),
      description: getDescription(doc, prop),
      required: requiredSet.has(name),
      enumValues,
      enumDescriptions,
      literalValue,
      unionVariants,
      addedIn: getAddedIn(doc, prop),
    };
  });
};

const getRefNameDeep = (schema?: OpenApiSchemaExt | null): string | null => {
  if (!schema) return null;
  if (schema.$ref) return getRefName(schema);
  if (schema.type === "array" && schema.items) {
    return getRefNameDeep(schema.items as OpenApiSchemaExt);
  }
  if (schema.allOf) {
    for (const item of schema.allOf) {
      const refName = getRefNameDeep(item as OpenApiSchemaExt);
      if (refName) return refName;
    }
  }
  return null;
};

const getSchemaKind = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
): SectionKind | null => {
  if (!schema) return null;
  if (schema.$ref) return getSchemaKind(doc, resolveRef(doc, schema));
  if (schema.anyOf || schema.oneOf) return "union";
  if (getEnumValues(doc, schema).length > 0) return "enum";
  if (schema.type === "object" || schema.properties) return "object";
  if (schema.type === "array" || schema.items) {
    const itemKind = getSchemaKind(doc, schema.items as OpenApiSchemaExt);
    return itemKind ?? null;
  }
  if (isSchemaComplex(doc, schema)) return "object";
  return null;
};

type UnionVariantEntry = {
  schema: OpenApiSchemaExt;
  array: boolean;
  labelOverride?: string;
  groupVariants?: ParameterUnionVariant[];
};

const getVariantLabel = (doc: OpenApiDocument, variant: OpenApiSchemaExt) => {
  const refName = getRefNameDeep(variant);
  const enumValues = getEnumValues(doc, variant);
  if (refName) return refName;
  if (enumValues.length === 1) return `"${String(enumValues[0])}"`;
  if (enumValues.length > 1) return "enum";
  return getTypeLabel(doc, variant);
};

const expandUnionVariantEntries = (
  doc: OpenApiDocument,
  schema: OpenApiSchemaExt,
  sections: ReferenceSections,
): UnionVariantEntry[] => {
  const resolved = resolveRef(doc, schema) ?? schema;
  if (resolved.type === "array" && resolved.items) {
    const itemSchema = resolved.items as OpenApiSchemaExt;
    const itemVariants = getUnionVariants(doc, itemSchema);
    if (itemVariants.length > 0) {
      const groupVariants = itemVariants.map((variant) => {
        const refName = getRefNameDeep(variant);
        const sectionId = refName
          ? (sections.byName.get(refName)?.id ?? null)
          : null;
        return {
          label: getVariantLabel(doc, variant),
          array: false,
          sectionId,
        } satisfies ParameterUnionVariant;
      });
      return [
        {
          schema,
          array: false,
          labelOverride: "array of",
          groupVariants,
        },
      ];
    }
    return [{ schema, array: true }];
  }
  return [{ schema, array: isArraySchema(doc, schema) }];
};

const buildUnionVariants = (
  doc: OpenApiDocument,
  schema: OpenApiSchemaExt,
  sections: ReferenceSections,
): ParameterUnionVariant[] => {
  const variantSchemas = getUnionVariants(doc, schema);
  const entries = variantSchemas.flatMap((variant) =>
    expandUnionVariantEntries(doc, variant, sections),
  );

  return entries.map(
    ({ schema: variant, array, labelOverride, groupVariants }) => {
      const refName = getRefNameDeep(variant);
      const sectionId = refName
        ? (sections.byName.get(refName)?.id ?? null)
        : null;
      return {
        label: labelOverride ?? getVariantLabel(doc, variant),
        array,
        sectionId,
        groupVariants,
      } satisfies ParameterUnionVariant;
    },
  );
};

const collectRefSchemas = (
  doc: OpenApiDocument,
  schema?: OpenApiSchemaExt | null,
  acc = new Map<string, OpenApiSchemaExt>(),
) => {
  if (!schema) return acc;

  if (schema.$ref) {
    const refName = getRefName(schema);
    const resolved = resolveRef(doc, schema) ?? schema;
    if (refName && !acc.has(refName)) {
      acc.set(refName, resolved);
      collectRefSchemas(doc, resolved, acc);
    }
    return acc;
  }

  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      collectRefSchemas(doc, prop as OpenApiSchemaExt, acc);
    }
  }
  if (schema.items) {
    collectRefSchemas(doc, schema.items as OpenApiSchemaExt, acc);
  }
  for (const variant of schema.anyOf || []) {
    collectRefSchemas(doc, variant as OpenApiSchemaExt, acc);
  }
  for (const variant of schema.oneOf || []) {
    collectRefSchemas(doc, variant as OpenApiSchemaExt, acc);
  }
  for (const variant of schema.allOf || []) {
    collectRefSchemas(doc, variant as OpenApiSchemaExt, acc);
  }

  return acc;
};

const buildSectionsFromRefs = (
  doc: OpenApiDocument,
  refs: Map<string, OpenApiSchemaExt>,
): ReferenceSections => {
  const enums: EnumSection[] = [];
  const objects: ObjectSection[] = [];
  const unions: UnionSection[] = [];
  const byName = new Map<string, { id: string; kind: SectionKind }>();
  const sections: ReferenceSections = { enums, objects, unions, byName };
  const refEntries = Array.from(refs.entries());
  const sectionEntries: Array<{
    name: string;
    schema: OpenApiSchemaExt;
    kind: SectionKind;
    id: string;
  }> = [];

  for (const [name, schema] of refEntries) {
    if (getInlineable(doc, schema)) continue;
    const kind = getSchemaKind(doc, schema);
    if (!kind) continue;
    const id = `${kind}-${name}`;
    if (byName.has(name)) continue;
    byName.set(name, { id, kind });
    sectionEntries.push({ name, schema, kind, id });
  }

  for (const entry of sectionEntries) {
    const { name, schema, kind, id } = entry;
    if (kind === "enum") {
      enums.push({
        kind,
        id,
        name,
        title: name,
        description: getDescription(doc, schema),
        values: getEnumValues(doc, schema),
        descriptions: getEnumDescriptions(doc, schema),
        addedIn: getAddedIn(doc, schema),
      });
      continue;
    }

    if (kind === "object") {
      objects.push({
        kind,
        id,
        name,
        title: name,
        description: getDescription(doc, schema),
        rows: buildInlineRows(doc, schema, sections),
        addedIn: getAddedIn(doc, schema),
      });
      continue;
    }

    if (kind === "union") {
      const unionTitle = getUnionTitle(doc, schema) || name;
      const variantEntries = getUnionVariants(doc, schema).flatMap((variant) =>
        expandUnionVariantEntries(doc, variant, sections),
      );
      const variants = variantEntries.map(
        ({ schema: variant, array, labelOverride, groupVariants }) => {
          const refName = getRefNameDeep(variant);
          const sectionId = refName ? (byName.get(refName)?.id ?? null) : null;
          const label = labelOverride ?? getVariantLabel(doc, variant);

          return {
            label,
            array,
            sectionId,
            groupVariants,
          } satisfies UnionVariantLink;
        },
      );

      unions.push({
        kind,
        id,
        name,
        title: unionTitle,
        description: getDescription(doc, schema),
        variants: variants.sort((a, b) => a.label.localeCompare(b.label)),
        addedIn: getAddedIn(doc, schema),
      });
    }
  }

  enums.sort((a, b) => a.name.localeCompare(b.name));
  objects.sort((a, b) => a.name.localeCompare(b.name));
  unions.sort((a, b) => a.name.localeCompare(b.name));

  return { enums, objects, unions, byName };
};

const collectRefsFromSchemas = (
  doc: OpenApiDocument,
  schemas: Array<OpenApiSchema | null | undefined>,
) => {
  const merged = new Map<string, OpenApiSchemaExt>();
  for (const schema of schemas) {
    if (!schema) continue;
    const refs = collectRefSchemas(doc, schema as OpenApiSchemaExt);
    for (const [name, refSchema] of refs) {
      if (!merged.has(name)) merged.set(name, refSchema);
    }
  }
  return merged;
};

const buildParameterRows = (
  doc: OpenApiDocument,
  schema: OpenApiSchema | null | undefined,
  sections: ReferenceSections,
): ParameterRow[] => {
  const properties = getSchemaProperties(doc, schema as OpenApiSchemaExt);
  if (!schema || !properties) return [];
  const requiredSet = new Set(
    getSchemaRequired(doc, schema as OpenApiSchemaExt),
  );

  return Object.entries(properties).map(([name, prop]) => {
    const enumValues = getEnumValues(doc, prop as OpenApiSchemaExt);
    const enumDescriptions = getEnumDescriptions(doc, prop as OpenApiSchemaExt);
    const literalValue = enumValues.length === 1 ? String(enumValues[0]) : null;
    const inlineable = getInlineable(doc, prop as OpenApiSchemaExt);

    const unionVariants = buildUnionVariants(
      doc,
      prop as OpenApiSchemaExt,
      sections,
    );

    const isUnion = unionVariants.length > 0;
    const typeRefName = getRefNameDeep(prop as OpenApiSchemaExt);
    const typeLinkId =
      !inlineable && typeRefName
        ? (sections.byName.get(typeRefName)?.id ?? null)
        : null;

    return {
      name,
      typeSummary: getTypeSummary(doc, prop),
      description: getDescription(doc, prop as OpenApiSchemaExt),
      required: requiredSet.has(name),
      enumValues,
      enumDescriptions,
      literalValue,
      inlineable,
      inlineRows: inlineable
        ? buildInlineRows(doc, prop as OpenApiSchemaExt, sections)
        : [],
      isUnion,
      unionVariants,
      typeLinkId,
      addedIn: getAddedIn(doc, prop as OpenApiSchemaExt),
    } satisfies ParameterRow;
  });
};

export const buildReferenceIndex = (
  doc: OpenApiDocument,
  requestSchema?: OpenApiSchema | null,
): ReferenceIndex => {
  const refs = collectRefsFromSchemas(doc, [requestSchema]);
  const sections = buildSectionsFromRefs(doc, refs);
  const parameterRows = buildParameterRows(doc, requestSchema, sections);
  return { parameterRows, sections };
};

export const buildReferenceSections = (
  doc: OpenApiDocument,
  schemas: Array<OpenApiSchema | null | undefined>,
): ReferenceSections => {
  const refs = collectRefsFromSchemas(doc, schemas);
  return buildSectionsFromRefs(doc, refs);
};
