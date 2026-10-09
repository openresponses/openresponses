using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

model EmptyModelParam {}

model FunctionToolParam {
  @minLength(1)
  @maxLength(64)
  @pattern("^[a-zA-Z0-9_-]+$")
  name: string;

  description?: string | null;
  parameters?: EmptyModelParam | null;
  strict?: boolean;
  type: "function" = "function";
}

@extension("discriminator", #{ propertyName: "type" })
@extension("x-unionDisplay", "section")
@extension("x-unionTitle", "Tool Types")
@oneOf
union ResponsesToolParam {
  FunctionToolParam,
}

model SpecificFunctionParam {
  /** The tool to call. Always `function`. */
  type: "function" = "function";

  /** The name of the function tool to call. */
  name: string;
}

@oneOf
union SpecificToolChoiceParam {
  SpecificFunctionParam,
}

@extension(
  "x-enumDescriptions",
  #{
    auto: "Let the model choose the tools from among the provided set.",
    none: "Restrict the model from calling any tools.",
    required: "Require the model to call a tool.",
  }
)
enum ToolChoiceValueEnum {
  none,
  auto,
  required,
}

model AllowedToolsParam {
  /** The tool choice type. Always `allowed_tools`. */
  type: "allowed_tools" = "allowed_tools";

  /** The list of tools that are permitted for this request. */
  @minItems(1)
  @maxItems(128)
  tools: SpecificToolChoiceParam[];

  /** How to select a tool from the allowed set. */
  mode?: ToolChoiceValueEnum;
}

/** Controls which tool the model should use, if any. */
@oneOf
union ToolChoiceParam {
  SpecificToolChoiceParam,
  ToolChoiceValueEnum,
  AllowedToolsParam,
}

/**
 * Defines a function in your own code the model can choose to call. Learn more about
 * [function calling](https://platform.openai.com/docs/guides/function-calling).
 */
@summary("Function")
model FunctionTool {
  /** The type of the function tool. Always `function`. */
  type: "function" = "function";

  /** The name of the function to call. */
  name: string;

  /**
   * A description of the function. Used by the model to determine whether or not to
   * call the function.
   */
  description: string | null;

  /** A JSON schema object describing the parameters of the function. */
  parameters: Record<unknown> | null;

  /** Whether to enforce strict parameter validation. Default `true`. */
  strict: boolean | null;
}

/** A tool that can be used to generate a response. */
@extension("discriminator", #{ propertyName: "type" })
@oneOf
union Tool {
  FunctionTool,
}

model FunctionToolChoice {
  type: "function" = "function";
  name?: string;
}

model AllowedToolChoice {
  type: "allowed_tools" = "allowed_tools";
  tools: FunctionToolChoice[];
  mode: ToolChoiceValueEnum;
}
