import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildReferenceIndex } from "./referenceIndex";
import { getAddedIn, getTypeSummary } from "./schema";
import type { OpenApiDocument } from "./types";

const doc: OpenApiDocument = {
  openapi: "3.1.0",
  paths: {},
  components: {
    schemas: {
      VersionedSchema: {
        type: "object",
        "x-openresponses-added-in": "2026-04-24",
      },
    },
  },
};

describe("getAddedIn", () => {
  test("reads a version directly from a schema", () => {
    expect(
      getAddedIn(doc, {
        type: "string",
        "x-openresponses-added-in": "2026-04-24",
      }),
    ).toBe("2026-04-24");
  });

  test("reads a version through a schema reference", () => {
    expect(
      getAddedIn(doc, { $ref: "#/components/schemas/VersionedSchema" }),
    ).toBe("2026-04-24");
  });

  test("returns null for unversioned schemas", () => {
    expect(getAddedIn(doc, { type: "string" })).toBeNull();
  });
});

describe("getTypeSummary", () => {
  test.each(["openapi.json", "2026-01-15/openapi.json"])(
    "summarizes published request and object rows from %s",
    (path) => {
      const published: OpenApiDocument = JSON.parse(
        readFileSync(
          new URL(`../../../public/openapi/${path}`, import.meta.url),
          "utf8",
        ),
      );
      const { parameterRows, sections } = buildReferenceIndex(published, {
        $ref: "#/components/schemas/CreateResponseBody",
      });
      expect(
        Object.fromEntries(
          parameterRows.map((row) => [row.name, row.typeSummary]),
        ),
      ).toMatchObject({
        model: "string | null",
        input: "string | ItemParam[] | null",
        include: "IncludeEnum[]",
        tools: "ResponsesToolParam[] | null",
        tool_choice: "ToolChoiceParam | null",
        metadata: "MetadataParam | null",
        temperature: "number | null",
        max_output_tokens: "integer | null",
        stream: "boolean",
      });
      const objectRows = Object.fromEntries(
        sections.objects.map((section) => [
          section.name,
          Object.fromEntries(
            section.rows.map((row) => [row.name, row.typeSummary]),
          ),
        ]),
      );
      expect(objectRows).toMatchObject({
        ItemReferenceParam: { type: '"item_reference" | null' },
        UserMessageItemParam: {
          role: '"user"',
          content: "object[] | string",
        },
        TextParam: { format: "TextFormatParam | null" },
      });
    },
  );

  test("distinguishes nullable arrays from arrays with nullable items", () => {
    const nullableString = {
      anyOf: [{ type: "string" }, { type: "null" }],
    };
    expect(
      getTypeSummary(doc, {
        anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
      }),
    ).toBe("string[] | null");
    expect(getTypeSummary(doc, { type: "array", items: nullableString })).toBe(
      "(string | null)[]",
    );
    expect(
      getTypeSummary(doc, { anyOf: [nullableString, { type: "null" }] }),
    ).toBe("string | null");
    expect(
      getTypeSummary(doc, {
        anyOf: [
          { allOf: [nullableString, { description: "An optional label." }] },
          { type: "null" },
        ],
      }),
    ).toBe("string | null");
  });

  test("renders singleton enum values as JSON literals", () => {
    for (const value of ['a "quoted" value', 0, false, null]) {
      const summary = getTypeSummary(doc, { enum: [value] });
      expect(JSON.parse(summary)).toEqual(value);
    }
  });
});
