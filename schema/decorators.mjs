import { $doc, isArrayModelType } from "@typespec/compiler";
import { setExtension } from "@typespec/openapi";
import { $oneOf } from "@typespec/openapi3";

const variants = (type) =>
  type.kind === "Union"
    ? [...type.variants.values()].map((variant) => variant.type)
    : [type];

export function $oneOfItems(context, property, description) {
  for (const type of variants(property.type)) {
    if (!isArrayModelType(context.program, type)) continue;
    if (type.indexer.value.kind !== "Union") {
      setExtension(
        context.program,
        property,
        "x-typespec-items-discriminator",
        "type",
      );
      continue;
    }
    $oneOf(context, type.indexer.value);
    if (description) $doc(context, type.indexer.value, description);
    setExtension(context.program, type.indexer.value, "discriminator", {
      propertyName: "type",
    });
  }
}

export function $oneOfBody(context, property) {
  if (property.type.kind !== "Union") return;
  $oneOf(context, property.type);
  setExtension(context.program, property.type, "discriminator", {
    propertyName: "type",
  });
}

export function $nestedOneOf(context, property) {
  setExtension(context.program, property, "x-typespec-nullable-one-of", true);
}

export function $intersect(context, model, base) {
  setExtension(
    context.program,
    model,
    "x-typespec-intersect",
    `#/components/schemas/${base.name}`,
  );
}

export const namespace = "OpenResponsesSchema";
