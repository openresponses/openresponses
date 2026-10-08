import { describe, expect, test } from "bun:test";
import { openApiDocumentsByVersion } from "./openapiVersions";
import type { OpenApiDocument } from "./openapi/types";
import { specVersionMetadata } from "./specVersionMetadata";

describe("versioned OpenAPI documents", () => {
  test("has one document for every specification release", () => {
    expect(Object.keys(openApiDocumentsByVersion).sort()).toEqual(
      specVersionMetadata.map(({ version }) => version).sort(),
    );
  });

  test("keeps WebSocket, compaction, and assistant phases out of January", () => {
    const january = openApiDocumentsByVersion["2026-01-15"] as OpenApiDocument;
    expect(january.paths["/responses/compact"]).toBeUndefined();
    expect(
      january.components?.schemas?.WebSocketResponseCreateEvent,
    ).toBeUndefined();
    expect(january.components?.schemas?.WebSocketErrorEvent).toBeUndefined();
    expect(
      january.components?.schemas?.AssistantMessageItemParam?.properties?.phase,
    ).toBeUndefined();
  });

  test("includes WebSocket, compaction, and assistant phases in April", () => {
    const april = openApiDocumentsByVersion["2026-04-24"] as OpenApiDocument;
    expect(april.paths["/responses/compact"]).toBeDefined();
    expect(
      april.components?.schemas?.WebSocketResponseCreateEvent,
    ).toBeDefined();
    expect(april.components?.schemas?.WebSocketErrorEvent).toBeDefined();
    expect(
      april.components?.schemas?.AssistantMessageItemParam?.properties?.phase,
    ).toBeDefined();
  });

  test("tags the OpenAPI surface added after January", () => {
    const january = openApiDocumentsByVersion["2026-01-15"] as OpenApiDocument;
    const april = openApiDocumentsByVersion["2026-04-24"] as OpenApiDocument;
    const januarySchemas = january.components?.schemas ?? {};
    const aprilSchemas = april.components?.schemas ?? {};

    for (const schemaName of Object.keys(aprilSchemas)) {
      const aprilSchema = aprilSchemas[schemaName];
      const januarySchema = januarySchemas[schemaName];
      if (!januarySchema) {
        expect(aprilSchema["x-openresponses-added-in"]).toBe("2026-04-24");
        continue;
      }

      const januaryProperties = januarySchema.properties ?? {};
      for (const [propertyName, property] of Object.entries(
        aprilSchema.properties ?? {},
      )) {
        if (!januaryProperties[propertyName]) {
          expect(property["x-openresponses-added-in"]).toBe("2026-04-24");
        }
      }
    }

    expect(
      april.paths["/responses"]["x-openresponses-websocket"]?.[
        "x-openresponses-added-in"
      ],
    ).toBe("2026-04-24");
    expect(
      april.paths["/responses/compact"].post?.["x-openresponses-added-in"],
    ).toBe("2026-04-24");
  });
});
