# Changelog

## 2026-10-23

[Specification](https://www.openresponses.org/specification/2026-10-23) · [Reference](https://www.openresponses.org/reference/2026-10-23) · [OpenAPI JSON](https://www.openresponses.org/openapi/2026-10-23/openapi.json)

- Added WebSocket-only `response.steer` requests and `response.steer.accepted`, `response.steer.pending`, and `response.steer.failed` notifications.
- Defined queued steering, automatic continuation, the `steered` incomplete reason, completion races, tool-result and approval handoffs, request-setting inheritance, and recovery after steering failures or disconnects.
- Added compliance tests that follow steering through the continuation's completion and verify rejection of invalid targets and unsupported request fields.

## 2026-04-24

[Specification](https://www.openresponses.org/specification/2026-04-24) · [Reference](https://www.openresponses.org/reference/2026-04-24) · [OpenAPI JSON](https://www.openresponses.org/openapi/2026-04-24/openapi.json)

- Added WebSocket transport for `/v1/responses`. Clients start turns with `response.create`, and servers reuse the same semantic streaming events as HTTP streaming.
- Defined sequential WebSocket turns, `previous_response_id` continuation, connection-local state for `store=false`, recovery after disconnects, the 60-minute connection limit, and structured error events.
- Added `POST /v1/responses/compact` and its request and response schemas, including the rules for continuing over WebSockets after compaction.
- Added the optional assistant-message `phase` field with `commentary` and `final_answer` values.
- Made `logprobs` optional in output-text objects and streaming events.
- Corrected the `createResponse` operation ID and completed the `ResponseResource` example.

## 2026-01-15

[Specification](https://www.openresponses.org/specification/2026-01-15) · [Reference](https://www.openresponses.org/reference/2026-01-15) · [OpenAPI JSON](https://www.openresponses.org/openapi/2026-01-15/openapi.json)

- Launched Open Responses as an open, multi-provider specification with a shared schema, semantic streaming events, item lifecycle rules, and extensible tooling.
