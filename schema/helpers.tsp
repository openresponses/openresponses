import "./decorators.mjs";
using TypeSpec.Reflection;
using TypeSpec.OpenAPI;
namespace OpenResponsesSchema;

extern dec oneOfItems(
  target: ModelProperty,
  discriminator?: valueof string,
  description?: valueof string
);
extern dec oneOfBody(target: ModelProperty, discriminator?: valueof string);
extern dec nestedOneOf(target: ModelProperty);
extern dec arrayDoc(target: ModelProperty, description: valueof string);
extern dec refDoc(target: ModelProperty, description: valueof string);
extern dec intersect(target: Model, base: Model);

@maxLength(Max)
@doc(Description)
scalar BoundedString<
  Max extends valueof integer,
  Description extends valueof string
> extends string;
@doc(Description)
scalar DescribedString<Description extends valueof string> extends string;
@doc(Description)
scalar DescribedInteger<Description extends valueof string> extends integer;
@doc(Description)
scalar DescribedNumber<Description extends valueof string> extends numeric;
@doc(Description)
scalar DescribedBoolean<Description extends valueof string> extends boolean;
@minValue(Min)
@doc(Description)
scalar MinInteger<
  Min extends valueof integer,
  Description extends valueof string
> extends integer;
@minValue(Min)
@maxValue(Max)
@doc(Description)
scalar RangeInteger<
  Min extends valueof integer,
  Max extends valueof integer,
  Description extends valueof string
> extends integer;
@doc(Description)
@extension("example", Example)
scalar ExampleString<
  Description extends valueof string,
  Example extends valueof string
> extends string;
@doc(Description)
@extension("enum", #[Value])
@extension("default", Value)
scalar DefaultLiteral<
  Value extends valueof string,
  Description extends valueof string
> extends string;
@doc(Description)
@extension("default", Value)
scalar DefaultBoolean<
  Value extends valueof boolean,
  Description extends valueof string
> extends boolean;
