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

test("generated Zod preserves nested extension fields and tool defaults", async () => {
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

    expect(
      createResponseBodySchema.parse({
        text: { future_option: true },
        tool_choice: { name: "run", future_option: true },
      }),
    ).toEqual({
      text: { future_option: true },
      tool_choice: { type: "function", name: "run", future_option: true },
    });
    const usage = {
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
      input_tokens_details: { cached_tokens: 0, future_count: 1 },
      output_tokens_details: { reasoning_tokens: 0 },
    };
    expect(usageSchema.parse(usage)).toEqual(usage);
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
