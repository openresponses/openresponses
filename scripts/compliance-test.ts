#!/usr/bin/env bun
/**
 * CLI script to run compliance tests against an API endpoint
 * Usage: bun scripts/compliance-test.ts [options]
 */

import {
  runAllTests,
  testTemplates,
  type TestConfig,
  type TestResult,
} from "../src/lib/compliance-tests";
import { responseResourceSchema } from "../src/generated/kubb/zod/responseResourceSchema";

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

interface CliConfig extends TestConfig {
  filterTests?: string[];
  filterFields?: string[];
  verbose: boolean;
}

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  const config: CliConfig = {
    baseUrl: process.env.API_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.API_KEY || process.env.OPENAI_API_KEY || "",
    authHeaderName: process.env.AUTH_HEADER_NAME || "Authorization",
    useBearerPrefix: process.env.USE_BEARER_PREFIX !== "false",
    model: process.env.MODEL || "gpt-4o-mini",
    verbose: false,
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--base-url":
      case "-u":
        if (nextArg) config.baseUrl = nextArg;
        i++;
        break;
      case "--api-key":
      case "-k":
        if (nextArg) config.apiKey = nextArg;
        i++;
        break;
      case "--auth-header":
      case "-h":
        if (nextArg) config.authHeaderName = nextArg;
        i++;
        break;
      case "--model":
      case "-m":
        if (nextArg) config.model = nextArg;
        i++;
        break;
      case "--filter":
      case "-f":
        if (nextArg) {
          config.filterTests = nextArg.split(",").map((s) => s.trim());
        }
        i++;
        break;
      case "--field":
        if (nextArg) {
          config.filterFields = nextArg.split(",").map((s) => s.trim());
        }
        i++;
        break;
      case "--verbose":
      case "-v":
        config.verbose = true;
        break;
      case "--no-bearer":
        config.useBearerPrefix = false;
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
${colors.bold}OpenResponses Compliance Test Suite${colors.reset}

${colors.bold}USAGE:${colors.reset}
  bun scripts/compliance-test.ts [OPTIONS]

${colors.bold}OPTIONS:${colors.reset}
  -u, --base-url <url>      API base URL (default: https://api.openai.com/v1)
  -k, --api-key <key>       API key for authentication
  -m, --model <model>       Model to use for tests (default: gpt-4o-mini)
  -h, --auth-header <name>  Auth header name (default: Authorization)
  -f, --filter <tests>      Run specific tests (comma-separated test IDs)
  --field <fields>          Show only errors for specific fields (comma-separated)
  -v, --verbose             Show detailed validation errors with full paths
  --no-bearer               Don't use Bearer prefix for API key
  --help                    Show this help message

${colors.bold}AVAILABLE TEST IDS:${colors.reset}
  basic-response            Basic text response test
  streaming-response        Streaming SSE response test
  system-prompt             System message test
  tool-calling              Function/tool calling test
  image-input               Image input test
  multi-turn                Multi-turn conversation test

${colors.bold}ENVIRONMENT VARIABLES:${colors.reset}
  API_BASE_URL              Default base URL
  API_KEY / OPENAI_API_KEY  Default API key
  AUTH_HEADER_NAME          Default auth header name
  MODEL                     Default model
  USE_BEARER_PREFIX         Set to "false" to disable Bearer prefix

${colors.bold}EXAMPLES:${colors.reset}
  # Test against OpenAI
  API_KEY=sk-... bun scripts/compliance-test.ts

  # Test against a local server
  bun scripts/compliance-test.ts --base-url http://localhost:3000/v1 --api-key test-key

  # Run only basic tests
  bun scripts/compliance-test.ts --filter basic-response --api-key sk-...

  # Run multiple specific tests with verbose output
  bun scripts/compliance-test.ts --filter basic-response,streaming-response -v --api-key sk-...

  # Focus on specific field errors
  bun scripts/compliance-test.ts --filter basic-response --field completed_at --api-key sk-...

  # Check multiple fields
  bun scripts/compliance-test.ts --filter basic-response --field completed_at,tools,usage --api-key sk-...

  # Test with custom model
  bun scripts/compliance-test.ts --model gpt-4o --api-key sk-...
`);
}

function printTestHeader(name: string, description: string) {
  // Don't print headers immediately - we'll print them with results
}

/**
 * Enhance error messages with detailed information about received values and expected types
 */
function enhanceErrorMessages(result: TestResult): TestResult {
  if (!result.errors || result.errors.length === 0 || !result.response) {
    return result;
  }

  // Only enhance if we have the raw response data
  const rawData = result.response;

  // Re-parse with Zod to get detailed error information
  const parseResult = responseResourceSchema.safeParse(rawData);

  if (!parseResult.success) {
    const enhancedErrors = parseResult.error.issues.map((issue) => {
      const path = issue.path.join(".");
      const fieldPath = path || "root";

      // Get the actual value that caused the error
      let actualValue: any = rawData;
      for (const key of issue.path) {
        if (actualValue !== null && actualValue !== undefined) {
          actualValue = actualValue[key];
        }
      }

      // Format the actual value for display
      let valueStr: string;
      if (actualValue === undefined) {
        valueStr = "undefined";
      } else if (actualValue === null) {
        valueStr = "null";
      } else if (typeof actualValue === "object") {
        valueStr = JSON.stringify(actualValue);
        if (valueStr.length > 100) {
          valueStr = valueStr.substring(0, 100) + "...";
        }
      } else {
        valueStr = String(actualValue);
      }

      // Build detailed error message
      let errorMsg = `${fieldPath}: ${issue.message}`;

      // Add received value
      errorMsg += `\n    Received: ${valueStr}`;

      // Add expected type if available
      if (issue.code === "invalid_type") {
        errorMsg += `\n    Expected: ${(issue as any).expected}`;
      }

      return errorMsg;
    });

    return {
      ...result,
      errors: enhancedErrors,
    };
  }

  return result;
}

function printTestResult(result: TestResult, verbose: boolean) {
  const statusSymbol =
    result.status === "passed"
      ? `${colors.green}✓${colors.reset}`
      : `${colors.red}✗${colors.reset}`;

  const statusColor = result.status === "passed" ? colors.green : colors.red;
  const duration = result.duration ? `${result.duration}ms` : "?";
  const streamInfo =
    result.streamEvents !== undefined ? ` · ${result.streamEvents} events` : "";

  // Test header with status
  console.log(
    `\n${statusSymbol} ${colors.bold}${result.name}${colors.reset} ${colors.gray}(${duration}${streamInfo})${colors.reset}`,
  );
  console.log(`  ${colors.gray}${result.description}${colors.reset}`);

  if (result.errors && result.errors.length > 0) {
    console.log(
      `\n  ${colors.bold}${colors.red}Errors (${result.errors.length}):${colors.reset}`,
    );
    result.errors.forEach((error, index) => {
      // Handle multi-line errors (with indentation)
      const lines = error.split("\n");
      console.log(`  ${colors.gray}${index + 1}.${colors.reset} ${lines[0]}`);
      for (let i = 1; i < lines.length; i++) {
        console.log(`     ${colors.gray}${lines[i]}${colors.reset}`);
      }
    });

    // If verbose, show the exact location in the response where the error occurred
    if (verbose && result.response && typeof result.response === "object") {
      console.log(
        `\n  ${colors.bold}${colors.yellow}Debugging Tips:${colors.reset}`,
      );
      console.log(
        `  ${colors.gray}• Fields marked "undefined" are missing from your API response${colors.reset}`,
      );
      console.log(
        `  ${colors.gray}• Fields marked "Invalid input" exist but have wrong type or structure${colors.reset}`,
      );
      console.log(
        `  ${colors.gray}• Use --field <name> to focus on specific field errors${colors.reset}`,
      );
    }
  }

  // Show request/response details for failed tests
  if (result.status === "failed") {
    if (result.request) {
      console.log(`\n  ${colors.bold}Request:${colors.reset}`);
      const requestStr = JSON.stringify(result.request, null, 2);
      const requestLines = requestStr.split("\n").slice(0, verbose ? 50 : 10);
      requestLines.forEach((line) =>
        console.log(`  ${colors.gray}${line}${colors.reset}`),
      );
      if (requestStr.split("\n").length > (verbose ? 50 : 10)) {
        console.log(
          `  ${colors.gray}... (truncated, use --verbose for full output)${colors.reset}`,
        );
      }
    }

    if (result.response) {
      console.log(`\n  ${colors.bold}Response:${colors.reset}`);
      const responseStr =
        typeof result.response === "string"
          ? result.response
          : JSON.stringify(result.response, null, 2);
      const responseLines = responseStr
        .split("\n")
        .slice(0, verbose ? 100 : 15);
      responseLines.forEach((line) =>
        console.log(`  ${colors.gray}${line}${colors.reset}`),
      );
      if (responseStr.split("\n").length > (verbose ? 100 : 15)) {
        console.log(
          `  ${colors.gray}... (truncated, use --verbose for full output)${colors.reset}`,
        );
      }
    }
  }
}

function printSummary(results: TestResult[]) {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const total = results.length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  console.log(
    `\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(`${colors.bold}  Summary${colors.reset}`);
  console.log(
    `${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`,
  );

  // Visual bar
  const barWidth = 40;
  const passedWidth = Math.round((passed / total) * barWidth);
  const failedWidth = barWidth - passedWidth;
  const passBar = "█".repeat(passedWidth);
  const failBar = "█".repeat(failedWidth);
  console.log(
    `  ${colors.green}${passBar}${colors.reset}${colors.red}${failBar}${colors.reset}`,
  );
  console.log();

  console.log(`  ${colors.bold}Results:${colors.reset}`);
  console.log(`    ${colors.green}✓ ${passed} passed${colors.reset}`);
  console.log(`    ${colors.red}✗ ${failed} failed${colors.reset}`);
  console.log(`    ${colors.gray}${total} total${colors.reset}`);
  console.log();
  console.log(
    `  ${colors.bold}Pass rate:${colors.reset} ${passed === total ? colors.green : failed === total ? colors.red : colors.yellow}${passRate}%${colors.reset}`,
  );
  console.log(
    `  ${colors.bold}Duration:${colors.reset}  ${colors.gray}${totalDuration}ms${colors.reset}`,
  );

  console.log(
    `\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`,
  );

  if (failed > 0) {
    console.log(
      `${colors.red}${failed} test${failed === 1 ? "" : "s"} failed.${colors.reset} Review the errors above to fix compliance issues.\n`,
    );
  } else {
    console.log(
      `${colors.green}All tests passed!${colors.reset} Your API is fully compliant with the OpenResponses specification.\n`,
    );
  }
}

async function main() {
  const config = parseArgs();

  if (!config.apiKey) {
    console.error(`${colors.red}Error:${colors.reset} API key is required`);
    console.error(
      `Set API_KEY or OPENAI_API_KEY environment variable, or use --api-key flag`,
    );
    console.error(`Run with --help for more information`);
    process.exit(1);
  }

  // Filter tests if requested
  const testsToRun = config.filterTests
    ? testTemplates.filter((t) => config.filterTests!.includes(t.id))
    : testTemplates;

  if (config.filterTests && testsToRun.length === 0) {
    console.error(
      `${colors.red}Error:${colors.reset} No tests match the filter: ${config.filterTests.join(", ")}`,
    );
    console.error(
      `Available test IDs: ${testTemplates.map((t) => t.id).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    `\n${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(
    `${colors.bold}  OpenResponses Compliance Test Suite${colors.reset}`,
  );
  console.log(
    `${colors.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`,
  );

  console.log(`${colors.bold}Configuration:${colors.reset}`);
  console.log(`  ${colors.blue}Base URL:${colors.reset} ${config.baseUrl}`);
  console.log(`  ${colors.blue}Model:${colors.reset}    ${config.model}`);
  console.log(
    `  ${colors.blue}Auth:${colors.reset}     ${config.authHeaderName}${config.useBearerPrefix ? " (Bearer)" : ""}`,
  );
  console.log(
    `  ${colors.blue}Tests:${colors.reset}    ${testsToRun.length} of ${testTemplates.length} test suites`,
  );
  if (config.filterTests) {
    console.log(
      `  ${colors.blue}Filter:${colors.reset}   ${config.filterTests.join(", ")}`,
    );
  }
  if (config.filterFields) {
    console.log(
      `  ${colors.blue}Fields:${colors.reset}   ${config.filterFields.join(", ")}`,
    );
  }
  if (config.verbose) {
    console.log(`  ${colors.blue}Mode:${colors.reset}     Verbose`);
  }
  console.log();

  console.log(`${colors.bold}Running tests...${colors.reset}`);

  const results: TestResult[] = [];
  const runningTests = new Set<string>();

  // Create a custom version of runAllTests for filtered tests
  const runFilteredTests = async (
    testConfig: TestConfig,
    onProgress: (result: TestResult) => void,
  ): Promise<TestResult[]> => {
    const promises = testsToRun.map(async (template) => {
      onProgress({
        id: template.id,
        name: template.name,
        description: template.description,
        status: "running",
      });

      // Import runTest from compliance-tests
      const { default: ComplianceTester } =
        await import("../src/lib/compliance-tests");
      const runTest = ((await import("../src/lib/compliance-tests")) as any)
        .runTest;

      // Since runTest is not exported, we need to call runAllTests with filtered list
      // Let's use a workaround
      return null as any;
    });

    return Promise.all(promises);
  };

  // Use the regular runAllTests but filter in the callback
  await runAllTests(config, (result) => {
    // Skip tests not in our filter
    if (config.filterTests && !config.filterTests.includes(result.id)) {
      return;
    }

    if (result.status === "running") {
      runningTests.add(result.id);
      printTestHeader(result.name, result.description);
    } else if (runningTests.has(result.id)) {
      // Enhance error messages with detailed information
      let enhancedResult = enhanceErrorMessages(result);

      // Filter errors by field if requested
      if (config.filterFields && enhancedResult.errors) {
        enhancedResult.errors = enhancedResult.errors.filter((error) => {
          const fieldName = error.split(":")[0].trim();
          return config.filterFields!.some(
            (filter) =>
              fieldName.includes(filter) || fieldName.startsWith(filter),
          );
        });

        // Update error count in result
        if (enhancedResult.errors.length === 0) {
          console.log(
            `\n  ${colors.yellow}ℹ${colors.reset} No errors found for fields: ${config.filterFields.join(", ")}`,
          );
          console.log(
            `  ${colors.gray}Either these fields are valid or they don't exist in the error list${colors.reset}`,
          );
        }
      }

      printTestResult(enhancedResult, config.verbose);
      results.push(enhancedResult);
      runningTests.delete(result.id);
    }
  });

  printSummary(results);

  // Exit with error code if any tests failed
  const hasFailures = results.some((r) => r.status === "failed");
  process.exit(hasFailures ? 1 : 0);
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
