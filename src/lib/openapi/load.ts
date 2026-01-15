import fs from "node:fs/promises";
import path from "node:path";
import type { OpenApiDocument } from "./types";

let cachedDoc: OpenApiDocument | null = null;

export async function loadOpenApiDocument(): Promise<OpenApiDocument> {
  if (cachedDoc) return cachedDoc;

  const openapiPath = path.join(
    process.cwd(),
    "public",
    "openapi",
    "openapi.json",
  );
  const text = await fs.readFile(openapiPath, "utf8");
  cachedDoc = JSON.parse(text) as OpenApiDocument;
  return cachedDoc;
}
