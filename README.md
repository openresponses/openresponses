# Open Responses

Open Responses is an open-source specification for multi-provider, interoperable LLM interfaces inspired by the OpenAI Responses API. It defines a shared request/response model, streaming semantics, and tool invocation patterns so clients and providers can exchange structured inputs and outputs in a consistent shape.

At a high level, the spec centers on:

- An agentic loop that lets models emit tool calls, receive results, and continue.
- Items as the atomic unit of context, with clear state machines and streaming updates.
- Semantic streaming events (not raw text deltas) for predictable, provider-agnostic clients.
- Extensibility for provider-specific tools and item types without breaking the core schema.

## What's in this repo

- Full specification, which gets deployed concatenated as [`openapi.json`](https://www.openresponses.org/openapi/openapi.json) source is: [`public/openapi/openapi.json`](public/openapi/openapi.json)
- [`openresponses.org`](https://www.openresponses.org) website documentation content (source): [`src/pages`](src/pages/)
- Compliance tests: [`bin/compliance-test.ts`](bin/compliance-test.ts)

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
