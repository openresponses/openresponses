using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

model ReasoningSummaryContentParam {
  @doc("The content type. Always `summary_text`.")
  type: "summary_text" = "summary_text";

  @doc("The reasoning summary text.")
  @maxLength(10485760)
  text: string;
}

@summary("Input text")
@doc("A text input to the model.")
@extension("x-unionDisplay", "section")
@extension("x-unionTitle", "Content Type")
model InputTextContentParam {
  @doc("The type of the input item. Always `input_text`.")
  type: "input_text" = "input_text";

  @doc("The text input to the model.")
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

@summary("Input image")
@doc("An image input to the model. Learn about [image inputs](/docs/guides/vision)")
model InputImageContentParamAutoParam {
  @doc("The type of the input item. Always `input_image`.")
  type: "input_image" = "input_image";

  image_url?: BoundedString<
    20971520,
    "The URL of the image to be sent to the model. A fully qualified URL or base64 encoded image in a data URL."
  > | null;

  @refDoc("The detail level of the image to be sent to the model. One of `high`, `low`, or `auto`. Defaults to `auto`.")
  detail?: ImageDetail | null;
}

@summary("Input file")
@doc("A file input to the model.")
model InputFileContentParam {
  @doc("The type of the input item. Always `input_file`.")
  type: "input_file" = "input_file";

  filename?: DescribedString<"The name of the file to be sent to the model."> | null;
  file_data?: BoundedString<
    33554432,
    "The base64-encoded data of the file to be sent to the model."
  > | null;
  file_url?: DescribedString<"The URL of the file to be sent to the model."> | null;
}

model UrlCitationParam {
  @doc("The citation type. Always `url_citation`.")
  type: "url_citation" = "url_citation";

  @doc("The index of the first character of the citation in the message.")
  @minValue(0)
  start_index: integer;

  @doc("The index of the last character of the citation in the message.")
  @minValue(0)
  end_index: integer;

  @doc("The URL of the cited resource.")
  url: string;

  @doc("The title of the cited resource.")
  title: string;
}

model OutputTextContentParam {
  @doc("The content type. Always `output_text`.")
  type: "output_text" = "output_text";

  @doc("The text content.")
  @maxLength(10485760)
  text: string;

  @doc("Citations associated with the text content.")
  annotations?: UrlCitationParam[];
}

model RefusalContentParam {
  @doc("The content type. Always `refusal`.")
  type: "refusal" = "refusal";

  @doc("The refusal text.")
  @maxLength(10485760)
  refusal: string;
}

@summary("Input text")
@doc("A text input to the model.")
model InputTextContent {
  @doc("The type of the input item. Always `input_text`.")
  type: "input_text" = "input_text";

  @doc("The text input to the model.")
  text: string;
}

@summary("URL citation")
@doc("A citation for a web resource used to generate a model response.")
model UrlCitationBody {
  @doc("The type of the URL citation. Always `url_citation`.")
  type: "url_citation" = "url_citation";

  @doc("The URL of the web resource.")
  url: string;

  @doc("The index of the first character of the URL citation in the message.")
  start_index: integer;

  @doc("The index of the last character of the URL citation in the message.")
  end_index: integer;

  @doc("The title of the web resource.")
  title: string;
}

@doc("An annotation that applies to a span of output text.")
@extension("discriminator", #{ propertyName: "type" })
@oneOf
@extension("discriminator", #{ propertyName: "type" })
union Annotation {
  UrlCitationBody,
}

@summary("Top log probability")
@doc("The top log probability of a token.")
model TopLogProb {
  token: string;
  logprob: numeric;
  bytes: integer[];
}

@summary("Log probability")
@doc("The log probability of a token.")
model LogProb {
  token: string;
  logprob: numeric;
  bytes: integer[];
  top_logprobs: TopLogProb[];
}

@summary("Output text")
@doc("A text output from the model.")
model OutputTextContent {
  @doc("The type of the output text. Always `output_text`.")
  type: "output_text" = "output_text";

  @doc("The text output from the model.")
  text: string;

  @doc("The annotations of the text output.")
  annotations: Annotation[];

  logprobs?: LogProb[];
}

@summary("Text Content")
@doc("A text content.")
model TextContent {
  type: "text" = "text";
  text: string;
}

@summary("Summary text")
@doc("A summary text from the model.")
model SummaryTextContent {
  @doc("The type of the object. Always `summary_text`.")
  type: "summary_text" = "summary_text";

  @doc("A summary of the reasoning output from the model so far.")
  text: string;
}

@summary("Reasoning text")
@doc("Reasoning text from the model.")
model ReasoningTextContent {
  @doc("The type of the reasoning text. Always `reasoning_text`.")
  type: "reasoning_text" = "reasoning_text";

  @doc("The reasoning text from the model.")
  text: string;
}

@summary("Refusal")
@doc("A refusal from the model.")
model RefusalContent {
  @doc("The type of the refusal. Always `refusal`.")
  type: "refusal" = "refusal";

  @doc("The refusal explanation from the model.")
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

@summary("Input image")
@doc("An image input to the model. Learn about [image inputs](/docs/guides/vision).")
model InputImageContent {
  @doc("The type of the input item. Always `input_image`.")
  type: "input_image" = "input_image";

  image_url: DescribedString<"The URL of the image to be sent to the model. A fully qualified URL or base64 encoded image in a data URL."> | null;

  @refDoc("The detail level of the image to be sent to the model. One of `high`, `low`, or `auto`. Defaults to `auto`.")
  detail: ImageDetail;
}

@summary("Input file")
@doc("A file input to the model.")
model InputFileContent {
  @doc("The type of the input item. Always `input_file`.")
  type: "input_file" = "input_file";

  @doc("The name of the file to be sent to the model.")
  filename?: string;

  @doc("The URL of the file to be sent to the model.")
  file_url?: string;
}

@doc("A content block representing a video input to the model.")
model InputVideoContent {
  @doc("The type of the input content. Always `input_video`.")
  type: "input_video";

  @doc("A base64 or remote url that resolves to a video file.")
  video_url: string;
}
