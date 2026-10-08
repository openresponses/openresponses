# Authoring the Open Responses contract

`main.tsp` imports the complete contract. Edit the TypeSpec sources, then run
`bun run spec` from the repository root.

| File                | Definitions                                                  |
| ------------------- | ------------------------------------------------------------ |
| `content.tsp`       | Text, images, files, video, citations, and log probabilities |
| `items.tsp`         | Request and response items, messages, and item unions        |
| `tools.tsp`         | Function tools and tool selection                            |
| `configuration.tsp` | Reasoning, text formats, metadata, and request options       |
| `responses.tsp`     | Create/compact request bodies, response envelopes, and usage |
| `events.tsp`        | Streaming and WebSocket events                               |
| `routes.tsp`        | HTTP operations, version, server, and transport metadata     |

Requiredness and nullability are independent. A property with a default can
still be required. Request items and returned items have different constraints
and supported variants. The current contract also contains null-only fields;
do not widen these during a mechanical sync from another implementation.

## Emitter support

Most schemas use the standard OpenAPI 3.1 emitter. `helpers.tsp` and
`decorators.mjs` express the few shapes that need extra metadata: exclusive
array-element unions, nullable exclusive unions, array-branch documentation,
reference documentation wrappers, and the WebSocket intersection. Scalar templates preserve constraints,
descriptions, and defaults inside nullable branches without adding component
names.

`emitter.mjs` uses TypeSpec's OpenAPI document API and applies that metadata. It
also places the WebSocket extension on the path, retains the declared bearer
scheme without adding an authentication requirement, and renders simple record
constraints as `additionalProperties`. It does not read the published schema,
a dated release, or an upstream schema to generate or repair output.

## Comparison and releases

`bun run spec:check` compares a fresh compilation with the published file. The
comparison covers every component and operation, request/response media types,
security metadata, defaults, constraints, unions, and extensions. It ignores
object-key ordering and narrowly equivalent schema representations.

For a migration or proposed upstream sync, compare against a dated release:

```sh
python3 bin/compare_openapi.py \
  --baseline public/openapi/2026-04-24/openapi.json \
  --generated public/openapi/openapi.json
```

Documentation differences are reported separately; use `--check-documentation`
to make them fail the check. `--report PATH` writes the detailed comparison as
JSON. The contract tests also exercise payload boundaries against both the
current document and the April release.

The TypeSpec migration preserves all 108 component names, both operations,
and their validation contract. Every nonempty description, title, and example
is retained. Reference descriptions keep their existing `allOf` wrappers because
Kubb uses those wrappers when preserving unknown nested fields. Six other
descriptions move from nullable branches to their containing property without
changing their text. One empty description is omitted. Array-branch descriptions
and dated releases are preserved.
