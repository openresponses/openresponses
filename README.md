# Open Responses

Open Responses is an open-source specification for multi-provider, interoperable LLM interfaces inspired by the OpenAI Responses API. It defines a shared request/response model, streaming semantics, and tool invocation patterns so clients and providers can exchange structured inputs and outputs in a consistent shape.

At a high level, the spec centers on:

- An agentic loop that lets models emit tool calls, receive results, and continue.
- Items as the atomic unit of context, with clear state machines and streaming updates.
- Semantic streaming events (not raw text deltas) for predictable, provider-agnostic clients.
- Extensibility for provider-specific tools and item types without breaking the core schema.

## What's in this repo

- Full specification: `public/openapi/openapi.json`
- Website documentation content (source): `src/pages`
