# Open Responses

Open Responses is an open-source specification for multi-provider, interoperable LLM interfaces inspired by the OpenAI Responses API. It defines a shared request/response model, streaming semantics, and tool invocation patterns so clients and providers can exchange structured inputs and outputs in a consistent shape.

At a high level, the spec centers on:

- An agentic loop that lets models emit tool calls, receive results, and continue.
- Items as the atomic unit of context, with clear state machines and streaming updates.
- Semantic streaming events (not raw text deltas) for predictable, provider-agnostic clients.
- Extensibility for provider-specific tools and item types without breaking the core schema.

## What's in this repo

- Latest OpenAPI specification: `public/openapi/openapi.json`
- Dated specification releases: `public/openapi/<YYYY-MM-DD>/openapi.json`
- Specification changelog: `CHANGELOG.md`
- Website documentation content (source): `src/pages`
- Compliance tests: `bin/compliance-test.ts`

## Generating the schema

The contract is authored in TypeSpec under `schema/` and requires Node 22 or newer.
Run `bun install` once,
then `bun run spec` to generate `public/openapi/openapi.json`. Generation is
local and does not import an upstream OpenAI schema.

Run `bun run spec:check` to compile into a temporary output directory and check
that the published schema matches the source, including documentation. CI runs
this check alongside the contract tests.

Request and response types are intentionally separate. Preserve their existing
required fields, nullable values, defaults, and supported variants when syncing
changes from another implementation. See [schema/README.md](schema/README.md)
for the source layout and emitter details.

Dated releases under `public/openapi/<YYYY-MM-DD>/` are immutable. To publish a
new version, update the version in `schema/routes.tsp` and run
`bun run spec:release`. The TypeSpec migration retains the existing version and
contract; its documentation placement changes do not rewrite the dated release.

For focused local validation:

```sh
bun run spec:check
python3 -m pytest bin/compare_openapi_test.py bin/typespec_contract_test.py
```

The Python tests require `pytest` and `jsonschema`.

## Compliance testing

This repo includes an interactive compliance tester in the docs site (`/compliance`) and a CLI runner for faster local iteration and CI (`bin/compliance-test.ts`).

### Web UI

The interactive compliance tester is available at https://www.openresponses.org/compliance.

### CLI

Run the same compliance suite as the web UI from the command line. For example:

```bash
bun run test:compliance --base-url http://localhost:8000/v1 --api-key $API_KEY
```

Filter to specific tests:

```bash
bun run test:compliance --base-url http://localhost:8000/v1 --api-key $API_KEY --filter basic-response,streaming-response
```

For all flags:

```bash
bun run test:compliance --help
```
