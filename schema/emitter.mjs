import { createTypeSpecLibrary, emitFile } from "@typespec/compiler";
import { getOpenAPI3 } from "@typespec/openapi3";

export const $lib = createTypeSpecLibrary({
  name: "openresponses",
  diagnostics: {},
});

function arrays(schema) {
  if (schema.type === "array") return [schema];
  return ["anyOf", "oneOf"].flatMap((key) =>
    (schema[key] ?? []).flatMap(arrays),
  );
}

function finishSchema(schema) {
  if (typeof schema !== "object" || schema === null) return;
  if (schema.description === "") delete schema.description;
  const referenceDocumentation = schema["x-typespec-ref-description"];
  delete schema["x-typespec-ref-description"];
  if (referenceDocumentation) {
    const refDescription = schema.description;
    delete schema.description;
    const target = schema.$ref
      ? schema
      : schema.anyOf?.find((branch) => branch.$ref);
    if (!target)
      throw new Error("@refDoc requires a reference or nullable reference");
    const ref = target.$ref;
    delete target.$ref;
    target.allOf = [{ $ref: ref }, { description: refDescription }];
  }
  if (schema["x-typespec-nullable-one-of"]) {
    delete schema["x-typespec-nullable-one-of"];
    const alternatives = schema.anyOf.filter(
      (branch) => branch.type !== "null",
    );
    schema.anyOf = [{ oneOf: alternatives }, { type: "null" }];
  }
  const discriminator = schema["x-typespec-items-discriminator"];
  const description = schema["x-typespec-array-description"];
  delete schema["x-typespec-items-discriminator"];
  delete schema["x-typespec-array-description"];
  for (const array of arrays(schema)) {
    if (discriminator)
      array.items = {
        ...array.items,
        discriminator: { propertyName: discriminator },
      };
    if (description) array.description = description;
  }
  // These records have no applicators that could evaluate additional properties.
  if (
    schema.type === "object" &&
    "unevaluatedProperties" in schema &&
    !["allOf", "anyOf", "oneOf", "$ref", "if", "dependentSchemas"].some(
      (key) => key in schema,
    )
  ) {
    schema.additionalProperties = schema.unevaluatedProperties;
    delete schema.unevaluatedProperties;
  }
  for (const child of Object.values(schema.properties ?? {}))
    finishSchema(child);
  for (const key of ["items", "additionalProperties"])
    if (key in schema) finishSchema(schema[key]);
  for (const key of ["anyOf", "oneOf", "allOf"])
    for (const child of schema[key] ?? []) finishSchema(child);
}

export async function $onEmit(context) {
  const records = await getOpenAPI3(context.program, {
    "openapi-versions": ["3.1.0"],
    "omit-unreachable-types": false,
    "seal-object-schemas": false,
  });
  for (const { document, diagnostics } of records) {
    context.program.reportDiagnostics(diagnostics);
    if (context.program.hasError()) return;
    document.components.securitySchemes =
      document["x-openresponses-security-schemes"];
    delete document["x-openresponses-security-schemes"];
    if (document.tags?.length === 0) delete document.tags;
    for (const server of document.servers ?? []) {
      if (server.description === "") delete server.description;
      if (Object.keys(server.variables ?? {}).length === 0)
        delete server.variables;
    }
    for (const item of Object.values(document.paths)) {
      for (const operation of Object.values(item)) {
        if (operation["x-openresponses-websocket"]) {
          item["x-openresponses-websocket"] =
            operation["x-openresponses-websocket"];
          delete operation["x-openresponses-websocket"];
        }
        if (operation.requestBody?.required === false)
          delete operation.requestBody.required;
      }
    }
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      finishSchema(schema);
      if (!schema["x-typespec-intersect"]) continue;
      const {
        ["x-typespec-intersect"]: ref,
        type,
        properties,
        required,
        ...metadata
      } = schema;
      document.components.schemas[name] = {
        allOf: [{ type, properties, required }, { $ref: ref }],
        ...metadata,
      };
    }
    await emitFile(context.program, {
      path: `${context.emitterOutputDir}/openapi.json`,
      content: JSON.stringify(document, null, 2) + "\n",
    });
  }
}
