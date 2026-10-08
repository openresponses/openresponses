using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

model ReasoningSummaryContentParam {
  /** The content type. Always `summary_text`. */
  type: "summary_text" = "summary_text";

  /** The reasoning summary text. */
  @maxLength(10485760)
  text: string;
}

/** A text input to the model. */
@summary("Input text")
@extension("x-unionDisplay", "section")
@extension("x-unionTitle", "Content Type")
model InputTextContentParam {
  /** The type of the input item. Always `input_text`. */
  type: "input_text" = "input_text";

  /** The text input to the model. */
  @maxLength(10485760)
  text: string;
}

@extension(
  "x-enumDescriptions",
  #{
    auto: "Choose the detail level automatically.",
    high: "Allows the model to \"see\" a higher-resolution version of the image, usually increasing input token costs.",
    low: "Restricts the model to a lower-resolution version of the image.",
  }
)
enum DetailEnum {
  low,
  high,
  auto,
}

/** An image input to the model. Learn about [image inputs](/docs/guides/vision) */
@summary("Input image")
model InputImageContentParamAutoParam {
  /** The type of the input item. Always `input_image`. */
  type: "input_image" = "input_image";

  /**
   * The URL of the image to be sent to the model. A fully qualified URL or base64
   * encoded image in a data URL.
   */
  image_url?: BoundedString<20971520> | null;

  /**
   * The detail level of the image to be sent to the model. One of `high`, `low`, or
   * `auto`. Defaults to `auto`.
   */
  detail?: ImageDetail | null;
}

/** A file input to the model. */
@summary("Input file")
model InputFileContentParam {
  /** The type of the input item. Always `input_file`. */
  type: "input_file" = "input_file";

  /** The name of the file to be sent to the model. */
  filename?: string | null;

  /** The base64-encoded data of the file to be sent to the model. */
  file_data?: BoundedString<33554432> | null;

  /** The URL of the file to be sent to the model. */
  file_url?: string | null;
}

model UrlCitationParam {
  /** The citation type. Always `url_citation`. */
  type: "url_citation" = "url_citation";

  /** The index of the first character of the citation in the message. */
  @minValue(0)
  start_index: integer;

  /** The index of the last character of the citation in the message. */
  @minValue(0)
  end_index: integer;

  /** The URL of the cited resource. */
  url: string;

  /** The title of the cited resource. */
  title: string;
}

model OutputTextContentParam {
  /** The content type. Always `output_text`. */
  type: "output_text" = "output_text";

  /** The text content. */
  @maxLength(10485760)
  text: string;

  /** Citations associated with the text content. */
  annotations?: UrlCitationParam[];
}

model RefusalContentParam {
  /** The content type. Always `refusal`. */
  type: "refusal" = "refusal";

  /** The refusal text. */
  @maxLength(10485760)
  refusal: string;
}

/** A text input to the model. */
@summary("Input text")
model InputTextContent {
  /** The type of the input item. Always `input_text`. */
  type: "input_text" = "input_text";

  /** The text input to the model. */
  text: string;
}

/** A citation for a web resource used to generate a model response. */
@summary("URL citation")
model UrlCitationBody {
  /** The type of the URL citation. Always `url_citation`. */
  type: "url_citation" = "url_citation";

  /** The URL of the web resource. */
  url: string;

  /** The index of the first character of the URL citation in the message. */
  start_index: integer;

  /** The index of the last character of the URL citation in the message. */
  end_index: integer;

  /** The title of the web resource. */
  title: string;
}

/** An annotation that applies to a span of output text. */
@extension("discriminator", #{ propertyName: "type" })
@oneOf
@extension("discriminator", #{ propertyName: "type" })
union Annotation {
  UrlCitationBody,
}

/** The top log probability of a token. */
@summary("Top log probability")
model TopLogProb {
  token: string;
  logprob: numeric;
  bytes: integer[];
}

/** The log probability of a token. */
@summary("Log probability")
model LogProb {
  token: string;
  logprob: numeric;
  bytes: integer[];
  top_logprobs: TopLogProb[];
}

/** A text output from the model. */
@summary("Output text")
model OutputTextContent {
  /** The type of the output text. Always `output_text`. */
  type: "output_text" = "output_text";

  /** The text output from the model. */
  text: string;

  /** The annotations of the text output. */
  annotations: Annotation[];

  logprobs?: LogProb[];
}

/** A text content. */
@summary("Text Content")
model TextContent {
  type: "text" = "text";
  text: string;
}

/** A summary text from the model. */
@summary("Summary text")
model SummaryTextContent {
  /** The type of the object. Always `summary_text`. */
  type: "summary_text" = "summary_text";

  /** A summary of the reasoning output from the model so far. */
  text: string;
}

/** Reasoning text from the model. */
@summary("Reasoning text")
model ReasoningTextContent {
  /** The type of the reasoning text. Always `reasoning_text`. */
  type: "reasoning_text" = "reasoning_text";

  /** The reasoning text from the model. */
  text: string;
}

/** A refusal from the model. */
@summary("Refusal")
model RefusalContent {
  /** The type of the refusal. Always `refusal`. */
  type: "refusal" = "refusal";

  /** The refusal explanation from the model. */
  refusal: string;
}

@extension(
  "x-enumDescriptions",
  #{
    auto: "Choose the detail level automatically.",
    high: "Allows the model to \"see\" a higher-resolution version of the image, usually increasing input token costs.",
    low: "Restricts the model to a lower-resolution version of the image.",
  }
)
enum ImageDetail {
  low,
  high,
  auto,
}

/** An image input to the model. Learn about [image inputs](/docs/guides/vision). */
@summary("Input image")
model InputImageContent {
  /** The type of the input item. Always `input_image`. */
  type: "input_image" = "input_image";

  /**
   * The URL of the image to be sent to the model. A fully qualified URL or base64
   * encoded image in a data URL.
   */
  image_url: string | null;

  /**
   * The detail level of the image to be sent to the model. One of `high`, `low`, or
   * `auto`. Defaults to `auto`.
   */
  detail: ImageDetail;
}

/** A file input to the model. */
@summary("Input file")
model InputFileContent {
  /** The type of the input item. Always `input_file`. */
  type: "input_file" = "input_file";

  /** The name of the file to be sent to the model. */
  filename?: string;

  /** The URL of the file to be sent to the model. */
  file_url?: string;
}

/** A content block representing a video input to the model. */
model InputVideoContent {
  /** The type of the input content. Always `input_video`. */
  type: "input_video";

  /** A base64 or remote url that resolves to a video file. */
  video_url: string;
}
