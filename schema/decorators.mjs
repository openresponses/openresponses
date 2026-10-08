import { $doc, isArrayModelType } from "@typespec/compiler";
import { setExtension } from "@typespec/openapi";
import { $oneOf } from "@typespec/openapi3";

const variants = (type) =>
  type.kind === "Union"
    ? [...type.variants.values()].map((variant) => variant.type)
    : [type];

export function $oneOfItems(context, property, discriminator, description) {
  for (const type of variants(property.type)) {
    if (!isArrayModelType(context.program, type)) continue;
    if (type.indexer.value.kind !== "Union") {
      setExtension(
        context.program,
        property,
        "x-typespec-items-discriminator",
        discriminator,
      );
      continue;
    }
    $oneOf(context, type.indexer.value);
    if (description) $doc(context, type.indexer.value, description);
    if (discriminator)
      setExtension(context.program, type.indexer.value, "discriminator", {
        propertyName: discriminator,
      });
  }
}

export function $oneOfBody(context, property, discriminator) {
  if (property.type.kind !== "Union") return;
  $oneOf(context, property.type);
  if (discriminator)
    setExtension(context.program, property.type, "discriminator", {
      propertyName: discriminator,
    });
}

export function $nestedOneOf(context, property) {
  setExtension(context.program, property, "x-typespec-nullable-one-of", true);
}

export function $arrayDoc(context, property, description) {
  setExtension(
    context.program,
    property,
    "x-typespec-array-description",
    description,
  );
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
