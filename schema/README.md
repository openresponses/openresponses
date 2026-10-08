# Schema authoring

Edit these TypeSpec files, then run `bun run spec` from the repository root.
`main.tsp` imports the complete contract.

| File                | Contents                                                     |
| ------------------- | ------------------------------------------------------------ |
| `content.tsp`       | Text, images, files, video, citations, and log probabilities |
| `items.tsp`         | Messages, tool calls, and other request/response items       |
| `tools.tsp`         | Tool definitions and selection                               |
| `configuration.tsp` | Reasoning, text formats, metadata, and request options       |
| `responses.tsp`     | Request bodies, response objects, and usage                  |
| `events.tsp`        | Streaming and WebSocket events                               |
| `routes.tsp`        | HTTP operations, version, and transport metadata             |

Keep request and response types separate: their required fields, nullability,
and supported variants differ. Defaults do not make required fields optional.
Preserve null-only fields when syncing changes from another implementation.

Use `/** ... */` comments for published descriptions; `//` comments stay in the
source. Keep descriptions above fields, not inside type arguments. The scalar
helpers apply constraints and defaults to individual union members.

`helpers.tsp`, `decorators.mjs`, and `emitter.mjs` handle the schema forms and
metadata the standard emitter cannot preserve directly. Kubb compatibility
belongs in `kubb.config.ts`, not in the TypeSpec definitions or published schema.

## Checking changes

`bun run spec:check` verifies that the generated document matches the TypeSpec
source, including documentation. To compare a proposed change with a release:

```sh
python3 bin/compare_openapi.py \
  --baseline public/openapi/2026-04-24/openapi.json \
  --generated public/openapi/openapi.json
```

The comparison checks the full contract and reports documentation changes
separately. Add `--check-documentation` to fail on those changes too, or
`--report PATH` to save the result as JSON.
