using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

@extension(
  "x-enumDescriptions",
  #{
    `message.output_text.logprobs`: "includes sampled logprobs in assistant messages.",
    `reasoning.encrypted_content`: "includes encrypted reasoning content so that it may be rehydrated on a subsequent request.",
  }
)
enum IncludeEnum {
  value0: "reasoning.encrypted_content",
  value1: "message.output_text.logprobs",
}

/**
 * Set of 16 key-value pairs that can be attached to an object. This can be useful for
 * storing additional information about the object in a structured format, and querying
 * for objects via API or the dashboard. Keys are strings with a maximum length of 64
 * characters. Values are strings with a maximum length of 512 characters.
 */
@extension("maxProperties", 16)
model MetadataParam is Record<BoundedString<512>>;

@extension(
  "x-enumDescriptions",
  #{
    high: "Instruct the model to emit more verbose final responses.",
    low: "Instruct the model to emit less verbose final responses.",
    medium: "Use the model's default verbosity setting.",
  }
)
enum VerbosityEnum {
  low,
  medium,
  high,
}

model TextParam {
  /** The format configuration for text output. */
  @oneOf
  format?: TextFormatParam | null;

  /** Controls the level of detail in generated text output. */
  @refDoc
  verbosity?: VerbosityEnum;
}

/** Options that control streamed response behavior. */
model StreamOptionsParam {
  /**
   * Whether to obfuscate sensitive information in streamed output. Defaults to `true`.
   */
  include_obfuscation?: boolean;
}

@extension(
  "x-enumDescriptions",
  #{
    high: "Use a higher reasoning effort to improve answer quality.",
    medium: "Use a balanced reasoning effort.",
    low: "Use a lower reasoning effort for faster responses.",
    minimal: "Use the lowest non-zero reasoning effort.",
    none: "Restrict the model from performing any reasoning before emitting a final answer.",
    xhigh: "Use the maximum reasoning effort available.",
  }
)
enum ReasoningEffortEnum {
  none,
  low,
  medium,
  high,
  xhigh,
}

@extension(
  "x-enumDescriptions",
  #{
    auto: "Allow the model to decide when to summarize.",
    concise: "Emit concise summaries of reasoning content.",
    detailed: "Emit details summaries of reasoning content.",
  }
)
enum ReasoningSummaryEnum {
  concise,
  detailed,
  auto,
}

/**
 * **gpt-5 and o-series models only** Configuration options for [reasoning
 * models](https://platform.openai.com/docs/guides/reasoning).
 */
model ReasoningParam {
  /**
   * Controls the level of reasoning effort the model should apply. Higher effort may
   * increase latency and cost.
   */
  effort?: ReasoningEffortEnum | null;

  /** Controls whether the response includes a reasoning summary. */
  @refDoc
  summary?: ReasoningSummaryEnum | null;
}

@extension(
  "x-enumDescriptions",
  #{
    auto: "Let the service decide how to truncate.",
    disabled: "Disable service truncation. Context over the model's context limit will result in a 400 error.",
  }
)
enum TruncationEnum {
  auto,
  disabled,
}

@extension(
  "x-enumDescriptions",
  #{
    auto: "Choose a service tier automatically based on current account state.",
    default: "Choose the default service tier.",
    flex: "Choose the flex service tier.",
    priority: "Choose the priority service tier.",
  }
)
enum ServiceTierEnum {
  auto,
  default,
  flex,
  priority,
}

model TextResponseFormat {
  type: "text" = "text";
}

model JsonObjectResponseFormat {
  type: "json_object" = "json_object";
}

model JsonSchemaResponseFormat {
  type: "json_schema" = "json_schema";
  name: string;
  description: string | null;
  schema: null;
  strict: boolean;
}

model TextField {
  @oneOf
  format: TextResponseFormat | JsonObjectResponseFormat | JsonSchemaResponseFormat;

  verbosity?: VerbosityEnum;
}

/** Reasoning configuration and metadata that were used for the response. */
@summary("Reasoning")
model Reasoning {
  /** The reasoning effort that was requested for the model, if specified. */
  effort: ReasoningEffortEnum | null;

  /** A model-generated summary of its reasoning that was produced, if available. */
  @refDoc
  summary: ReasoningSummaryEnum | null;
}

model JsonSchemaResponseFormatParam {
  /** The type of response format being defined. Always `json_schema`. */
  type?: "json_schema";

  /**
   * A description of what the response format is for, used by the model to determine
   * how to respond in the format.
   */
  description?: string;

  /**
   * The name of the response format. Must be a-z, A-Z, 0-9, or contain underscores and
   * dashes, with a maximum length of 64.
   */
  name?: string;

  /** The schema for the response format, described as a JSON Schema object. */
  @summary("JSON schema")
  schema?: Record<unknown>;

  /**
   * Whether to enable strict schema adherence when generating the output. If set to
   * true, the model will always follow the exact schema defined in the `schema` field.
   * Only a subset of JSON Schema is supported when `strict` is `true`.
   */
  strict?: DefaultBoolean<false> | null;
}

@oneOf
union TextFormatParam {
  TextResponseFormat,
  JsonSchemaResponseFormatParam,
}
