import type { OpenApiDocument, OpenApiOperation } from "./types";

export type HttpMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD"
  | "TRACE";

export function parseOperationSelector(selector: string): {
  method: HttpMethod;
  path: string;
} {
  const m = selector.match(/^\s*([A-Za-z]+)\s+(.+?)\s*$/);
  if (!m)
    throw new Error(
      `Invalid operation selector: "${selector}" (expected "METHOD /path")`,
    );
  const method = m[1].toUpperCase() as HttpMethod;
  const path = m[2];
  return { method, path };
}

export function findOperation(
  doc: OpenApiDocument,
  method: HttpMethod,
  path: string,
): OpenApiOperation | null {
  const pi = doc.paths?.[path];
  if (!pi) return null;
  const op = (pi as any)[method.toLowerCase()] as OpenApiOperation | undefined;
  return op ?? null;
}

export function apiBasePath(doc: OpenApiDocument): string {
  const u = doc.servers?.[0]?.url;
  if (!u) return "";
  try {
    const url = new URL(u);
    return url.pathname === "/" ? "" : url.pathname;
  } catch {
    return "";
  }
}
