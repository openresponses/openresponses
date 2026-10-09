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

## Developing the site

Run `bun run dev` to generate the schema and start Astro. For remote access,
set `DEV_ALLOWED_HOSTS` to a comma-separated list of hostnames:

```sh
DEV_ALLOWED_HOSTS=docs.example.test bun run dev --host 0.0.0.0
```

The allowlist also applies to `bun run preview`.

## Generating the schema

Use Bun, Node 22 or newer, and Python 3. Edit the TypeSpec files in `schema/`,
then generate and check the OpenAPI document:

```sh
bun install
bun run spec
bun run spec:check
```

Prettier formats staged files, including `.tsp` files, on commit.
See [schema/README.md](schema/README.md) for the source layout and comparison tools.

To release a new version, update the version in `schema/routes.tsp` and run
`bun run spec:release`. Dated releases in `public/openapi/<YYYY-MM-DD>/` are
immutable.

For the schema tests, install `pytest` and `jsonschema`, then run:

```sh
python3 -m pytest bin/compare_openapi_test.py bin/typespec_contract_test.py bin/openresponses_contract_test.py
```

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
