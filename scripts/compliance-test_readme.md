# OpenResponses Compliance Test Suite

A command-line tool for testing API endpoints against the OpenResponses specification. This tool validates that your API implementation correctly follows the OpenResponses schema and behavior requirements.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage](#usage)
- [Command-Line Options](#command-line-options)
- [Available Tests](#available-tests)
- [Understanding Test Results](#understanding-test-results)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# Test against OpenAI
API_KEY=sk-... npm run test:compliance

# Test your local API
npm run test:compliance -- --base-url http://localhost:8000/v1 --api-key test-key

# Run only basic test
npm run test:compliance -- --filter basic-response --api-key test-key --base-url http://localhost:8000/v1

# Focus on specific field errors
npm run test:compliance -- --filter basic-response --field completed_at,tools --api-key test-key --base-url http://localhost:8000/v1
```

## Installation

The compliance test suite is included in the project. Just run:

```bash
npm install
```

## Usage

```bash
npm run test:compliance -- [OPTIONS]
```

Or directly with Bun:

```bash
bun scripts/compliance-test.ts [OPTIONS]
```

## Command-Line Options

### Required Options

- `-k, --api-key <key>` - API key for authentication (or set `API_KEY` / `OPENAI_API_KEY` environment variable)

### Optional Configuration

- `-u, --base-url <url>` - API base URL (default: `https://api.openai.com/v1`)
- `-m, --model <model>` - Model to use for tests (default: `gpt-4o-mini`)
- `-h, --auth-header <name>` - Auth header name (default: `Authorization`)
- `--no-bearer` - Don't use Bearer prefix for API key

### Filtering Options

- `-f, --filter <tests>` - Run specific tests only (comma-separated test IDs)
- `--field <fields>` - Show only errors for specific fields (comma-separated)

### Output Options

- `-v, --verbose` - Show detailed validation errors with full request/response data
- `--help` - Show help message

### Environment Variables

- `API_BASE_URL` - Default base URL
- `API_KEY` / `OPENAI_API_KEY` - Default API key
- `AUTH_HEADER_NAME` - Default auth header name
- `MODEL` - Default model
- `USE_BEARER_PREFIX` - Set to `"false"` to disable Bearer prefix

## Available Tests

| Test ID              | Name                    | Description                                            |
| -------------------- | ----------------------- | ------------------------------------------------------ |
| `basic-response`     | Basic Text Response     | Simple user message, validates ResponseResource schema |
| `streaming-response` | Streaming Response      | Validates SSE streaming events and final response      |
| `system-prompt`      | System Prompt           | Include system role message in input                   |
| `tool-calling`       | Tool Calling            | Define a function tool and verify function_call output |
| `image-input`        | Image Input             | Send image URL in user content                         |
| `multi-turn`         | Multi-turn Conversation | Send assistant + user messages as conversation history |

## Understanding Test Results

### Test Output Format

```
✗ Basic Text Response (1735ms)
  Simple user message, validates ResponseResource schema

  Errors (3):
  1. completed_at: Invalid input
      Received: undefined
  2. tools: Required
      Received: undefined
      Expected: array
  3. usage: Invalid input
      Received: {"input_tokens":27,"output_tokens":4,"total_tokens":31}
```

### Error Types

#### 1. Missing Fields (Received: undefined)

Field is completely absent from your API response.

**Example:**

```
completed_at: Invalid input
    Received: undefined
```

**Fix:** Add the missing field to your response.

#### 2. Required Fields (Required)

Field is required by the spec but not present.

**Example:**

```
tools: Required
    Received: undefined
    Expected: array
```

**Fix:** Add the required field with the correct type.

#### 3. Invalid Type/Structure (Invalid input)

Field exists but doesn't match the expected schema.

**Example:**

```
usage: Invalid input
    Received: {"input_tokens":27,"output_tokens":4,"total_tokens":31}
```

**Fix:** Check the OpenResponses spec for the correct structure of this field. The field names or structure may differ from what you're returning.

### Summary Statistics

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ████████████████████████████████████████

  Results:
    ✓ 5 passed
    ✗ 1 failed
    6 total

  Pass rate: 83.3%
  Duration:  15234ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **Visual bar** - Green for passed tests, red for failed
- **Pass rate** - Percentage of tests that passed
- **Duration** - Total time to run all tests

## Examples

### 1. Test Against OpenAI

```bash
API_KEY=sk-... npm run test:compliance
```

### 2. Test Local Development Server

```bash
npm run test:compliance -- \
  --base-url http://localhost:8000/v1 \
  --api-key test-key \
  --model "Qwen/Qwen2.5-1.5B-Instruct"
```

### 3. Run Specific Tests

```bash
# Run only basic response test
npm run test:compliance -- \
  --filter basic-response \
  --api-key test-key \
  --base-url http://localhost:8000/v1

# Run multiple tests
npm run test:compliance -- \
  --filter basic-response,streaming-response \
  --api-key test-key \
  --base-url http://localhost:8000/v1
```

### 4. Debug Specific Fields

```bash
# Focus on one field
npm run test:compliance -- \
  --filter basic-response \
  --field completed_at \
  --api-key test-key \
  --base-url http://localhost:8000/v1

# Check multiple fields
npm run test:compliance -- \
  --filter basic-response \
  --field "completed_at,tools,usage" \
  --api-key test-key \
  --base-url http://localhost:8000/v1
```

### 5. Verbose Output

```bash
# See full request/response data
npm run test:compliance -- \
  --filter basic-response \
  -v \
  --api-key test-key \
  --base-url http://localhost:8000/v1

# Combine with field filter
npm run test:compliance -- \
  --filter basic-response \
  --field usage \
  -v \
  --api-key test-key \
  --base-url http://localhost:8000/v1
```

### 6. Custom Authentication

```bash
# Use custom auth header without Bearer prefix
npm run test:compliance -- \
  --base-url http://localhost:8000/v1 \
  --api-key my-secret-key \
  --auth-header "X-API-Key" \
  --no-bearer
```

## Troubleshooting

### Problem: "API key is required" error

**Solution:** Set the API key using either:

- Command line: `--api-key sk-...`
- Environment variable: `API_KEY=sk-...` or `OPENAI_API_KEY=sk-...`

### Problem: All tests failing with HTTP errors

**Solutions:**

1. Check that your API server is running
2. Verify the base URL is correct
3. Check authentication credentials
4. Look at the HTTP error code in the output for clues

### Problem: Too many errors, can't focus on one issue

**Solution:** Use filtering options to narrow down:

```bash
# Start with just the basic test
npm run test:compliance -- --filter basic-response --api-key sk-... --base-url http://localhost:8000/v1

# Then focus on specific problematic fields
npm run test:compliance -- --filter basic-response --field tools,usage --api-key sk-...
```

### Problem: Field shows "Invalid input" but looks correct

**Solution:** Use verbose mode to see the full response structure:

```bash
npm run test:compliance -- --filter basic-response --field usage -v --api-key sk-...
```

Then compare your response structure to the OpenResponses specification.

### Problem: Don't understand what a field should contain

**Solution:**

1. Check the OpenResponses specification at `/specification`
2. Run tests against OpenAI to see compliant responses:
   ```bash
   API_KEY=sk-... npm run test:compliance -- --filter basic-response -v
   ```
3. Compare your response to OpenAI's response

## Workflow for Achieving Compliance

### 1. Initial Assessment

Run all tests to see overall compliance:

```bash
npm run test:compliance -- --api-key sk-... --base-url http://localhost:8000/v1
```

### 2. Focus on Basic Test First

Start with the simplest test:

```bash
npm run test:compliance -- --filter basic-response --api-key sk-... --base-url http://localhost:8000/v1
```

### 3. Fix Missing Required Fields

Identify all "Required" errors and add those fields:

```bash
npm run test:compliance -- --filter basic-response --field "tools,truncation,parallel_tool_calls" --api-key sk-...
```

### 4. Fix Individual Field Issues

Work through each problematic field one at a time:

```bash
npm run test:compliance -- --filter basic-response --field usage -v --api-key sk-...
```

### 5. Move to Advanced Tests

Once basic test passes, move to others:

```bash
npm run test:compliance -- --filter streaming-response --api-key sk-... --base-url http://localhost:8000/v1
npm run test:compliance -- --filter tool-calling --api-key sk-... --base-url http://localhost:8000/v1
```

### 6. Final Verification

Run all tests to confirm full compliance:

```bash
npm run test:compliance -- --api-key sk-... --base-url http://localhost:8000/v1
```

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed

This makes the tool suitable for CI/CD pipelines.

## Tips

1. **Start small** - Use `--filter` to run one test at a time
2. **Focus** - Use `--field` to debug specific fields
3. **Compare** - Run the same test against OpenAI to see correct responses
4. **Iterate** - Fix one issue at a time and re-run tests
5. **Automate** - Add to CI/CD to prevent regressions

## Web Interface

You can also use the web-based compliance tester:

```bash
npm run dev
```

Then navigate to `http://localhost:4321/compliance` to access the interactive UI where you can configure and run tests in your browser.
