import type {
  OpenApiDocument,
  OpenApiReference,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchema,
} from "./types";

function decodePointerSegment(seg: string): string {
  // JSON Pointer escaping per RFC 6901
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function getByJsonPointer(doc: unknown, pointer: string): unknown {
  if (!pointer.startsWith("#/")) return undefined;
  const parts = pointer
    .slice(2)
    .split("/")
    .map((s) => decodePointerSegment(s));

  let cur: any = doc;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function isRef(v: unknown): v is OpenApiReference {
  return (
    typeof v === "object" &&
    v !== null &&
    "$ref" in v &&
    typeof (v as any).$ref === "string"
  );
}

export function resolveRef<T>(
  doc: OpenApiDocument,
  ref: string,
): T | undefined {
  // Only local refs are expected in the generated schema.
  if (!ref.startsWith("#/")) return undefined;
  return getByJsonPointer(doc as any, ref) as T | undefined;
}

export function derefSchema(
  doc: OpenApiDocument,
  schema: OpenApiSchema,
): OpenApiSchema {
  if (!schema || !isRef(schema)) return schema;
  const resolved = resolveRef<OpenApiSchema>(doc, schema.$ref);
  return resolved ?? schema;
}

export function derefRequestBody(
  doc: OpenApiDocument,
  rb: OpenApiRequestBody | OpenApiReference,
): OpenApiRequestBody {
  if (!rb || !isRef(rb)) return rb as OpenApiRequestBody;
  const resolved = resolveRef<OpenApiRequestBody>(doc, rb.$ref);
  return (resolved ?? rb) as OpenApiRequestBody;
}

export function derefResponse(
  doc: OpenApiDocument,
  resp: OpenApiResponse | OpenApiReference,
): OpenApiResponse {
  if (!resp || !isRef(resp)) return resp as OpenApiResponse;
  const resolved = resolveRef<OpenApiResponse>(doc, resp.$ref);
  return (resolved ?? resp) as OpenApiResponse;
}

export function refName(ref: string): string | null {
  // Common format: #/components/schemas/Foo
  const m = ref.match(/#\/components\/schemas\/([^/]+)$/);
  if (m) return decodePointerSegment(m[1]);
  return null;
}
