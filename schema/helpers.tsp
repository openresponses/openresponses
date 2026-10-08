import "./decorators.mjs";
using TypeSpec.Reflection;
using TypeSpec.OpenAPI;
namespace OpenResponsesSchema;

// Metadata for unions, nested documentation, and WebSocket composition.
extern dec oneOfItems(
  target: ModelProperty,
  discriminator?: valueof string,
  description?: valueof string
);
extern dec oneOfBody(target: ModelProperty, discriminator?: valueof string);
extern dec nestedOneOf(target: ModelProperty);
extern dec arrayDoc(target: ModelProperty, description: valueof string);
extern dec intersect(target: Model, base: Model);

// Apply bounds to the scalar member of a union, rather than the whole property.
@maxLength(Max)
scalar BoundedString<Max extends valueof integer> extends string;

@minValue(Min)
scalar MinInteger<Min extends valueof integer> extends integer;

@minValue(Min)
@maxValue(Max)
scalar RangeInteger<Min extends valueof integer, Max extends valueof integer>
  extends integer;

// These defaults belong to the non-null member of a nullable property.
@extension("enum", #[Value])
@extension("default", Value)
scalar DefaultLiteral<Value extends valueof string> extends string;

@extension("default", Value)
scalar DefaultBoolean<Value extends valueof boolean> extends boolean;
