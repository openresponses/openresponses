import currentDocument from "../../public/openapi/openapi.json" with { type: "json" };
import document20260115 from "../../public/openapi/2026-01-15/openapi.json" with { type: "json" };
import document20260424 from "../../public/openapi/2026-04-24/openapi.json" with { type: "json" };
import document20261023 from "../../public/openapi/2026-10-23/openapi.json" with { type: "json" };
import type { OpenApiDocument } from "./openapi/types";
import type { SpecVersion } from "./specVersionMetadata";

export const currentOpenApiDocument = currentDocument as OpenApiDocument;

export const openApiDocumentsByVersion = {
  "2026-10-23": document20261023,
  "2026-01-15": document20260115,
  "2026-04-24": document20260424,
} satisfies Record<SpecVersion, OpenApiDocument>;

export const findOpenApiDocument = (version: SpecVersion) =>
  openApiDocumentsByVersion[version];
