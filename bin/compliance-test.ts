#!/usr/bin/env bun

import {
  testTemplates,
  runAllTests,
  type TestConfig,
  type TestResult,
} from "../src/lib/compliance-tests";

const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

interface CliArgs {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  authHeader?: string;
  noBearer?: boolean;
  fileSearchVectorStoreId?: string;
  enableOfflineWebSearch?: boolean;
  filter?: string[];
  verbose?: boolean;
  json?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    const nextArg = argv[i + 1];

    switch (arg) {
      case "--base-url":
      case "-u":
        args.baseUrl = nextArg;
        i += 2;
        break;
      case "--api-key":
      case "-k":
        args.apiKey = nextArg;
        i += 2;
        break;
      case "--model":
      case "-m":
        args.model = nextArg;
        i += 2;
        break;
      case "--auth-header":
        args.authHeader = nextArg;
        i += 2;
        break;
      case "--no-bearer":
        args.noBearer = true;
        i += 1;
        break;
      case "--file-search-vector-store-id":
        args.fileSearchVectorStoreId = nextArg;
        i += 2;
        break;
      case "--enable-offline-web-search":
        args.enableOfflineWebSearch = true;
        i += 1;
        break;
      case "--filter":
      case "-f":
        args.filter = nextArg.split(",").map((s) => s.trim());
        i += 2;
        break;
      case "--verbose":
      case "-v":
        args.verbose = true;
        i += 1;
        break;
      case "--json":
        args.json = true;
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        i += 1;
        break;
      default:
        i += 1;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage: bun run bin/compliance-test.ts [options]

Options:
  -u, --base-url <url>        API base URL (required)
  -k, --api-key <key>         API key (required, or set OPENRESPONSES_API_KEY env var)
  -m, --model <model>         Model name (default: gpt-4o-mini)
      --auth-header <name>    Auth header name (default: Authorization)
      --no-bearer             Disable Bearer prefix in auth header
      --file-search-vector-store-id <id>
                              Enable file_search test with an existing vector store
      --enable-offline-web-search
                              Enable web_search test with external_web_access=false
  -f, --filter <ids>          Filter tests by ID (comma-separated)
  -v, --verbose               Verbose output with request/response details
      --json                  Output results as JSON
  -h, --help                  Show this help message

Examples:
  bun run test:compliance --base-url http://localhost:8000/v1 --api-key sk-test-123
  bun run test:compliance -u https://api.openai.com/v1 -k $OPENAI_API_KEY --filter basic-response
  bun run test:compliance -u $API_URL -k $API_KEY --json > results.json

Environment Variables:
  OPENRESPONSES_API_KEY       Default API key if --api-key is not provided
`);
}

function getStatusIcon(status: TestResult["status"]): string {
  switch (status) {
    case "passed":
      return colors.green("✓");
    case "failed":
      return colors.red("✗");
    case "running":
      return colors.yellow("◉");
    case "pending":
      return colors.gray("○");
    case "skipped":
      return colors.gray("-");
  }
}

function printResult(result: TestResult, verbose: boolean) {
  const icon = getStatusIcon(result.status);
  const duration = result.duration ? ` (${result.duration}ms)` : "";
  const events =
    result.streamEvents !== undefined ? ` [${result.streamEvents} events]` : "";
  const name =
    result.status === "failed" ? colors.red(result.name) : result.name;

  console.log(`${icon} ${name}${duration}${events}`);

  if (result.status === "skipped" && result.errors?.length) {
    for (const error of result.errors) {
      console.log(`  ${colors.gray("-")} ${error}`);
    }
  }

  if (result.status === "failed" && result.errors?.length) {
    for (const error of result.errors) {
      console.log(`  ${colors.red("✗")} ${error}`);
    }

    if (verbose) {
      if (result.request) {
        console.log(`\n  Request:`);
        console.log(
          `  ${JSON.stringify(result.request, null, 2).split("\n").join("\n  ")}`,
        );
      }
      if (result.response) {
        console.log(`\n  Response:`);
        const responseStr =
          typeof result.response === "string"
            ? result.response
            : JSON.stringify(result.response, null, 2);
        console.log(`  ${responseStr.split("\n").join("\n  ")}`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const baseUrl = args.baseUrl;
  if (!baseUrl) {
    console.error(`${colors.red("Error:")} --base-url is required`);
    console.error(`Run with --help for usage information.`);
    process.exit(1);
  }

  const apiKey = args.apiKey || process.env.OPENRESPONSES_API_KEY;
  if (!apiKey) {
    console.error(
      `${colors.red("Error:")} --api-key is required or set OPENRESPONSES_API_KEY environment variable`,
    );
    console.error(`Run with --help for usage information.`);
    process.exit(1);
  }

  const config: TestConfig = {
    baseUrl,
    apiKey,
    model: args.model || "gpt-4o-mini",
    authHeaderName: args.authHeader || "Authorization",
    useBearerPrefix: !args.noBearer,
    fileSearchVectorStoreId: args.fileSearchVectorStoreId,
    enableOfflineWebSearch: args.enableOfflineWebSearch,
  };

  if (args.filter?.length) {
    const availableIds = testTemplates.map((t) => t.id);
    const invalidFilters = args.filter.filter(
      (id) => !availableIds.includes(id),
    );
    if (invalidFilters.length) {
      console.error(
        `${colors.red("Error:")} Invalid test IDs: ${invalidFilters.join(", ")}`,
      );
      console.error(`Available test IDs: ${availableIds.join(", ")}`);
      process.exit(1);
    }
  }

  const allUpdates: TestResult[] = [];

  const onProgress = (result: TestResult) => {
    if (args.filter && !args.filter.includes(result.id)) {
      return;
    }
    allUpdates.push(result);
    if (!args.json) {
      printResult(result, args.verbose || false);
    }
  };

  if (!args.json) {
    console.log(`Running compliance tests against: ${config.baseUrl}`);
    console.log(`Model: ${config.model}`);
    if (args.filter) {
      console.log(`Filter: ${args.filter.join(", ")}`);
    }
    console.log();
  }

  await runAllTests(config, onProgress);

  const finalResults = allUpdates.filter(
    (r) =>
      r.status === "passed" || r.status === "failed" || r.status === "skipped",
  );
  const passed = finalResults.filter((r) => r.status === "passed").length;
  const failed = finalResults.filter((r) => r.status === "failed").length;
  const skipped = finalResults.filter((r) => r.status === "skipped").length;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          summary: { passed, failed, skipped, total: finalResults.length },
          results: finalResults,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`\n${"=".repeat(50)}`);
    console.log(
      `Results: ${colors.green(`${passed} passed`)}, ${colors.red(`${failed} failed`)}, ${finalResults.length} total`,
    );
    if (skipped > 0) {
      console.log(`${colors.gray(`${skipped} skipped`)}`);
    }

    if (failed > 0) {
      console.log(`\nFailed tests:`);
      for (const r of finalResults) {
        if (r.status === "failed") {
          console.log(`\n${r.name}:`);
          for (const e of r.errors || []) {
            console.log(`  - ${e}`);
          }
        }
      }
    } else {
      console.log(`\n${colors.green("✓ All tests passed!")}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(colors.red("Fatal error:"), error);
  process.exit(1);
});
