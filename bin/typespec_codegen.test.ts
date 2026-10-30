import { expect, test } from "bun:test";
import { build } from "@kubb/core";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import kubbConfig from "../kubb.config";

const root = fileURLToPath(new URL("../", import.meta.url));

async function compile(entrypoint: string, output: string) {
  const compiler = Bun.spawn(
    [
      "node",
      join(root, "node_modules/@typespec/compiler/cmd/tsp.js"),
      "compile",
      entrypoint,
      "--config",
      join(root, "tspconfig.yaml"),
      "--emit",
      join(root, "schema/emitter.mjs"),
      "--output-dir",
      output,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    compiler.exited,
    new Response(compiler.stdout).text(),
    new Response(compiler.stderr).text(),
  ]);
  return { exitCode, output: stdout + stderr };
}

test("generated Zod preserves reference parsing, unknown fields, and steering constraints", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "openresponses-codegen-"));
  try {
    const result = await compile(join(root, "schema/main.tsp"), temporary);
    if (result.exitCode !== 0) throw new Error(result.output);

    const generated = join(temporary, "generated");
    await build({
      config: {
        ...kubbConfig,
        root: temporary,
        input: { path: join(temporary, "openapi.json") },
        output: { ...kubbConfig.output, path: generated },
      },
    });
    await symlink(join(root, "node_modules"), join(temporary, "node_modules"));
    const { createResponseBodySchema } = await import(
      join(generated, "zod/createResponseBodySchema.ts")
    );
    const { usageSchema } = await import(join(generated, "zod/usageSchema.ts"));
    const { textParamSchema } = await import(
      join(generated, "zod/textParamSchema.ts")
    );
    const { annotationSchema } = await import(
      join(generated, "zod/annotationSchema.ts")
    );
    const { reasoningParamSchema } = await import(
      join(generated, "zod/reasoningParamSchema.ts")
    );
    const { webSocketResponseSteerEventSchema: steerSchema } = await import(
      join(generated, "zod/webSocketResponseSteerEventSchema.ts")
    );
    const { webSocketResponseSteerFailedEventSchema: steerFailedSchema } =
      await import(
        join(generated, "zod/webSocketResponseSteerFailedEventSchema.ts")
      );

    const text = {
      format: { type: "text", future_format_option: true },
      future_option: true,
    };
    expect(
      createResponseBodySchema.parse({
        text,
        tool_choice: { name: "run", future_option: true },
        tools: [{ type: "function", name: "run", future_option: true }],
        future_option: true,
      }),
    ).toEqual({
      text,
      tool_choice: { type: "function", name: "run", future_option: true },
      tools: [{ type: "function", name: "run" }],
    });
    const usage = {
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
      input_tokens_details: { cached_tokens: 0, future_count: 1 },
      output_tokens_details: { reasoning_tokens: 0 },
    };
    expect(usageSchema.parse({ ...usage, future_count: 1 })).toEqual(usage);

    // Direct component use and unwrapped references keep stripping unknown fields.
    expect(textParamSchema.parse(text)).toEqual({ format: { type: "text" } });
    const citation = {
      type: "url_citation",
      start_index: 0,
      end_index: 1,
      url: "https://example.com",
      title: "Example",
    };
    expect(
      annotationSchema.parse({ ...citation, future_option: true }),
    ).toEqual(citation);

    expect(createResponseBodySchema.parse({})).toEqual({});
    expect(createResponseBodySchema.parse({ text: null })).toEqual({
      text: null,
    });
    for (const input of [
      { text: { verbosity: "invalid" } },
      { text: 1 },
      { tool_choice: { name: 1 } },
    ]) {
      expect(createResponseBodySchema.safeParse(input).success).toBe(false);
    }
    expect(
      usageSchema.safeParse({ ...usage, input_tokens_details: null }).success,
    ).toBe(false);
    expect(
      usageSchema.safeParse({
        ...usage,
        input_tokens_details: { cached_tokens: "invalid" },
      }).success,
    ).toBe(false);

    for (const effort of ["none", "low", "medium", "high", "xhigh", null]) {
      expect(reasoningParamSchema.parse({ effort })).toEqual({ effort });
    }
    expect(reasoningParamSchema.parse({})).toEqual({});
    for (const effort of ["invalid", 1, {}, []]) {
      expect(reasoningParamSchema.safeParse({ effort }).success).toBe(false);
    }

    const steer = {
      type: "response.steer",
      previous_response_id: "resp_original",
      input: "Focus on database changes.",
    };
    const inputLimit = "x".repeat(10_485_760);
    for (const input of [
      steer.input,
      inputLimit,
      `${inputLimit.slice(1)}🦉`,
      [{ role: "user", content: "Keep the API unchanged." }],
      [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Use this example." },
            { type: "input_image", image_url: "https://example.com/db.png" },
            { type: "input_file", file_url: "https://example.com/schema.sql" },
          ],
        },
      ],
    ]) {
      const request = { ...steer, input };
      expect(steerSchema.parse(request)).toEqual(request);
    }

    const rejectedRequests = {
      emptyInput: { ...steer, input: [] },
      requestOverride: { ...steer, model: "other-model" },
      laneOverride: { ...steer, stream_id: "other-lane" },
      extraMessageField: {
        ...steer,
        input: [{ role: "user", content: "hello", id: "msg_other" }],
      },
      overlongInput: { ...steer, input: `${inputLimit}x` },
      overlongContent: {
        ...steer,
        input: [{ role: "user", content: `${inputLimit}x` }],
      },
    };
    const failure = {
      type: "response.steer.failed",
      sequence_number: 1,
      steer: { previous_response_id: steer.previous_response_id },
      error: {
        type: "invalid_request_error",
        code: "invalid_input",
        message: "Unsupported steering input.",
      },
    };
    for (const input of [null, [{ role: "assistant", content: "hello" }]]) {
      const event = { ...failure, steer: { ...failure.steer, input } };
      expect(steerFailedSchema.parse(event)).toEqual(event);
    }
    const steeringResults: Record<string, boolean> = {
      ...Object.fromEntries(
        Object.entries(rejectedRequests).map(([name, request]) => [
          name,
          steerSchema.safeParse(request).success,
        ]),
      ),
      missingFailureInput: steerFailedSchema.safeParse(failure).success,
    };
    expect(steeringResults).toEqual({
      emptyInput: false,
      requestOverride: false,
      laneOverride: false,
      extraMessageField: false,
      overlongInput: false,
      overlongContent: false,
      missingFailureInput: false,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 120_000);

test("the emitter rejects invalid routes without publishing a document", async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), "openresponses-invalid-route-"),
  );
  try {
    await symlink(join(root, "node_modules"), join(temporary, "node_modules"));
    const entrypoint = join(temporary, "main.tsp");
    await writeFile(
      entrypoint,
      `import "@typespec/http";
using TypeSpec.Http;
@service namespace InvalidRoute {
  @route("/bad?x=1") @get op read(): string;
}`,
    );

    const result = await compile(entrypoint, temporary);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("@typespec/openapi3/path-query");
    expect(await Bun.file(join(temporary, "openapi.json")).exists()).toBe(
      false,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 30_000);
