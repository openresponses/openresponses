import { useState, useCallback, useId } from "react";
import {
  testTemplates,
  runAllTests,
  type TestResult,
  type TestConfig,
} from "../lib/compliance-tests";

interface Props {
  defaultApiKey?: string;
}

export default function ComplianceTester({ defaultApiKey = "" }: Props) {
  const id = useId();
  const [config, setConfig] = useState<TestConfig>({
    baseUrl: "https://api.openai.com/v1",
    apiKey: defaultApiKey,
    authHeaderName: "Authorization",
    useBearerPrefix: true,
    model: "gpt-4o-mini",
  });

  const [results, setResults] = useState<Map<string, TestResult>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());

  const handleRunTests = useCallback(async () => {
    setIsRunning(true);
    setResults(new Map());

    // Initialize all tests as pending
    const initialResults = new Map<string, TestResult>();
    testTemplates.forEach((test) => {
      initialResults.set(test.id, {
        id: test.id,
        name: test.name,
        description: test.description,
        status: "pending",
      });
    });
    setResults(initialResults);

    await runAllTests(config, (result) => {
      setResults((prev) => {
        const next = new Map(prev);
        next.set(result.id, result);
        return next;
      });
    });

    setIsRunning(false);
  }, [config]);

  const toggleExpanded = (testId: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
      } else {
        next.add(testId);
      }
      return next;
    });
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "pending":
        return <span className="text-stone-400">○</span>;
      case "running":
        return <span className="animate-pulse text-amber-600">◉</span>;
      case "passed":
        return <span className="text-green-600">✓</span>;
      case "failed":
        return <span className="text-red-600">✗</span>;
    }
  };

  const getStatusBorder = (status: TestResult["status"]) => {
    switch (status) {
      case "pending":
        return "border-stone-300";
      case "running":
        return "border-amber-500/50";
      case "passed":
        return "border-green-500/50";
      case "failed":
        return "border-red-500/50";
    }
  };

  const passedCount = Array.from(results.values()).filter(
    (r) => r.status === "passed",
  ).length;
  const failedCount = Array.from(results.values()).filter(
    (r) => r.status === "failed",
  ).length;
  const totalTests = testTemplates.length;

  return (
    <div className="space-y-8">
      {/* Configuration Form */}
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="mt-0 mb-6 font-mono text-xl font-semibold text-stone-900">
          Configuration
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor={`${id}-baseUrl`}
              className="mb-2 block text-sm font-medium text-stone-700"
            >
              Base URL
            </label>
            <input
              id={`${id}-baseUrl`}
              type="text"
              value={config.baseUrl}
              onChange={(e) =>
                setConfig((c) => ({ ...c, baseUrl: e.target.value }))
              }
              className="w-full rounded-md border border-stone-300 bg-white px-4 py-2 font-mono text-sm text-stone-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div>
            <label
              htmlFor={`${id}-model`}
              className="mb-2 block text-sm font-medium text-stone-700"
            >
              Model
            </label>
            <input
              id={`${id}-model`}
              type="text"
              value={config.model}
              onChange={(e) =>
                setConfig((c) => ({ ...c, model: e.target.value }))
              }
              className="w-full rounded-md border border-stone-300 bg-white px-4 py-2 font-mono text-sm text-stone-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
              placeholder="gpt-4o-mini"
            />
          </div>

          <div>
            <label
              htmlFor={`${id}-apiKey`}
              className="mb-2 block text-sm font-medium text-stone-700"
            >
              API Key
            </label>
            <input
              id={`${id}-apiKey`}
              type="password"
              value={config.apiKey}
              onChange={(e) =>
                setConfig((c) => ({ ...c, apiKey: e.target.value }))
              }
              className="w-full rounded-md border border-stone-300 bg-white px-4 py-2 font-mono text-sm text-stone-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
              placeholder="sk-..."
            />
          </div>

          <div>
            <label
              htmlFor={`${id}-authHeaderName`}
              className="mb-2 block text-sm font-medium text-stone-700"
            >
              Auth Header Name
            </label>
            <input
              id={`${id}-authHeaderName`}
              type="text"
              value={config.authHeaderName}
              onChange={(e) =>
                setConfig((c) => ({ ...c, authHeaderName: e.target.value }))
              }
              className="w-full rounded-md border border-stone-300 bg-white px-4 py-2 font-mono text-sm text-stone-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
              placeholder="Authorization"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor={`${id}-useBearerPrefix`}
              className="flex cursor-pointer items-center gap-3"
            >
              <input
                id={`${id}-useBearerPrefix`}
                type="checkbox"
                checked={config.useBearerPrefix}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    useBearerPrefix: e.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-stone-300 bg-white text-orange-600 focus:ring-orange-500/50"
              />
              <span className="text-sm text-stone-600">
                Use Bearer prefix (e.g., "Bearer sk-...")
              </span>
            </label>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-4">
          <button
            type="button"
            onClick={handleRunTests}
            disabled={isRunning || !config.apiKey}
            className="rounded-md bg-orange-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-orange-500 focus:ring-2 focus:ring-orange-500/50 focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {isRunning ? "Running..." : "Run All Tests"}
          </button>

          {results.size > 0 && (
            <div className="font-mono text-sm">
              <span className="text-green-600">{passedCount} passed</span>
              {" · "}
              <span className="text-red-600">{failedCount} failed</span>
              {" · "}
              <span className="text-stone-500">{totalTests} total</span>
            </div>
          )}
        </div>
      </section>

      {/* Test Results */}
      <section className="space-y-4">
        <h2 className="font-mono text-xl font-semibold text-stone-900">
          Test Suite
        </h2>

        <div className="space-y-3">
          {testTemplates.map((test) => {
            const result = results.get(test.id) || {
              id: test.id,
              name: test.name,
              description: test.description,
              status: "pending" as const,
            };
            const isExpanded = expandedTests.has(test.id);

            return (
              <div
                key={test.id}
                className={`not-prose rounded-lg border bg-white ${getStatusBorder(result.status)} overflow-hidden shadow-sm transition-colors`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(test.id)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-stone-50"
                >
                  <span className="text-xl">
                    {getStatusIcon(result.status)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-mono font-medium text-stone-900">
                      {test.name}
                    </h3>
                    <p className="truncate text-sm text-stone-600">
                      {test.description}
                    </p>
                  </div>
                  {result.duration && (
                    <span className="font-mono text-xs text-stone-500">
                      {result.duration}ms
                    </span>
                  )}
                  {result.streamEvents !== undefined && (
                    <span className="font-mono text-xs text-stone-500">
                      {result.streamEvents} events
                    </span>
                  )}
                  <span
                    className={`text-stone-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  >
                    ▼
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-stone-200 px-5 pb-4">
                    {result.errors && result.errors.length > 0 && (
                      <div className="mt-4">
                        <h4 className="mb-2 text-sm font-medium text-red-600">
                          Errors
                        </h4>
                        <ul className="space-y-1">
                          {result.errors.map((error) => (
                            <li
                              key={error}
                              className="rounded border border-red-200 bg-red-50 px-3 py-2 font-mono text-sm text-red-700"
                            >
                              {error}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {result.request && (
                      <div className="mt-4">
                        <h4 className="mb-2 text-sm font-medium text-stone-700">
                          Request
                        </h4>
                        <pre className="max-h-48 overflow-x-auto rounded border border-stone-200 bg-stone-50 p-3 font-mono text-xs text-stone-800">
                          {JSON.stringify(result.request, null, 2)}
                        </pre>
                      </div>
                    )}

                    {result.response && (
                      <div className="mt-4">
                        <h4 className="mb-2 text-sm font-medium text-stone-700">
                          Response
                        </h4>
                        <pre className="max-h-64 overflow-x-auto rounded border border-stone-200 bg-stone-50 p-3 font-mono text-xs text-stone-800">
                          {typeof result.response === "string"
                            ? result.response
                            : JSON.stringify(result.response, null, 2)}
                        </pre>
                      </div>
                    )}

                    {result.status === "pending" && (
                      <p className="mt-4 text-sm text-stone-500 italic">
                        Test has not been run yet
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
