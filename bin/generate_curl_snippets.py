#!/usr/bin/env python3
"""Generate cURL examples for the OpenResponses API.

The script reads a YAML configuration file describing the examples you want,
calls the OpenAI Responses API to synthesize representative `curl` snippets,
and writes the results to `public/curl_snippets/<name>.sh`. Each declared
schema dependency is automatically inlined (mirroring bin/generate_examples.py)
and provided as context. A manifest file tracks the digest of each example so
snippets are regenerated only when the YAML entry or any schema dependency changes.

Usage:
    python bin/generate_curl_snippets.py
    python bin/generate_curl_snippets.py --force
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping

import yaml
from openai import AsyncOpenAI, BadRequestError

from generate_examples import inline_all_schemas

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "public/curl_snippets" / "curl_snippets.yaml"
OUTPUT_DIR = ROOT / "public" / "curl_snippets"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"

DEFAULT_MODEL = "gpt-4.1"
MAX_CONCURRENCY = 4

INSTRUCTIONS = """
You produce cURL command examples for the OpenResponses API.

Requirements:
- Return only the cURL command, no prose or Markdown fences.
- Use Bourne shell line continuations (`\\`) so the snippet is copy-pasteable.
- Include headers that are typically required (`Authorization`, `Content-Type`,
  and any other critical ones).
- Prefer double quotes and single spacing between flags.
- When request bodies are shown, use `--data`/`--data-raw` with compact but
  realistic JSON inspired by the provided schemas.
- Keep the snippet concise but faithful to the description.
- always use the url "https://api.modelprovider.com/v1/responses"
- always include header "OpenResponses-Version: latest"
- Make sure json is nicely pretty-printed
- Where possible, use the shortened version of input, eg 
    input: 'tell me a joke', NOT
    Input: [{ type: "message", role: "user", content: "tell me a joke" ... }]
- Use either "openai" or "anthropic" as "provider", with a suitable model slug (gpt-5 for opeanai, sonnet-4.5 for anthropic)
- Always use --data with a json string, NOT heredoc
""".strip()


def ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def load_examples() -> List[Dict[str, Any]]:
    if not CONFIG_PATH.exists():
        raise SystemExit(
            f"Configuration file not found: {CONFIG_PATH}. "
            "Create it with a list of examples."
        )

    data = yaml.safe_load(CONFIG_PATH.read_text()) or []
    if not isinstance(data, list):
        raise SystemExit("curl_snippets.yaml must contain a top-level list.")

    normalized: List[Dict[str, Any]] = []
    for entry in data:
        if not isinstance(entry, dict):
            raise SystemExit("Each example entry must be a mapping.")
        name = entry.get("name")
        description = entry.get("description")
        if not isinstance(name, str) or not name:
            raise SystemExit("Each example requires a non-empty 'name' string.")
        if not isinstance(description, str) or not description.strip():
            raise SystemExit(f"Example '{name}' must include a description string.")

        deps = entry.get("dependencies", [])
        if deps is None:
            deps = []
        if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
            raise SystemExit(
                f"Example '{name}' has an invalid 'dependencies' field. "
                "It must be a list of schema names from components.schemas."
            )

        normalized.append(
            {
                "name": name,
                "description": description.strip(),
                "dependencies": deps,
                "metadata": {
                    key: value
                    for key, value in entry.items()
                    if key not in {"name", "description", "dependencies"}
                },
            }
        )

    return normalized


def load_schema_dependencies(
    names: List[str],
    inlined_schemas: Mapping[str, Any],
) -> Dict[str, str]:
    payloads: Dict[str, str] = {}
    for name in names:
        schema = inlined_schemas.get(name)
        if schema is None:
            raise SystemExit(
                f"Schema dependency '{name}' not found. Update curl_snippets.yaml "
                "or ensure the schema exists in public/openapi/openapi.json."
            )
        payloads[name] = json.dumps(schema, indent=2, ensure_ascii=False)
    return payloads


def compute_digest(example: Mapping[str, Any], dependencies: Mapping[str, str]) -> str:
    digest = hashlib.sha1()
    digest.update(json.dumps(example, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    for dep_name in sorted(dependencies):
        digest.update(dep_name.encode("utf-8"))
        digest.update(dependencies[dep_name].encode("utf-8"))
    return digest.hexdigest()


def read_manifest() -> Dict[str, str]:
    if not MANIFEST_PATH.exists():
        return {}
    try:
        return json.loads(MANIFEST_PATH.read_text() or "{}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Failed to parse manifest at {MANIFEST_PATH}: {exc}") from exc


def write_manifest(manifest: Mapping[str, str]) -> None:
    ensure_output_dir()
    MANIFEST_PATH.write_text(json.dumps(dict(manifest), indent=2))


def strip_code_fences(text: str) -> str:
    trimmed = text.strip()
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```[\w-]*\n", "", trimmed)
        trimmed = re.sub(r"\n```$", "", trimmed)
    return trimmed.strip()


def build_prompt(example: Mapping[str, Any], schemas: Mapping[str, str]) -> str:
    metadata = example.get("metadata") or {}
    metadata_json = json.dumps(metadata, indent=2, ensure_ascii=False)
    schema_blocks = []
    for name, content in schemas.items():
        schema_blocks.append(f"Schema '{name}':\n{content}")
    schema_section = "\n\n".join(schema_blocks) if schema_blocks else "No associated schema provided."

    return (
        "Generate a cURL command for the OpenResponses API.\n\n"
        f"Example name: {example['name']}\n"
        f"Description:\n{example['description']}\n\n"
        f"Additional metadata (JSON):\n{metadata_json}\n\n"
        f"{schema_section}\n"
        "Respond with only the cURL command."
    )


async def generate_snippet(
    example: Mapping[str, Any],
    schema_payloads: Mapping[str, str],
    output_path: Path,
    client: AsyncOpenAI,
    sem: asyncio.Semaphore,
) -> None:
    prompt = build_prompt(example, schema_payloads)

    async with sem:
        print(f"generating curl snippet for {example['name']}")
        response = await client.responses.create(
            model=DEFAULT_MODEL,
            input=prompt,
            instructions=INSTRUCTIONS,
            store=False,
            max_output_tokens=600,
        )
        snippet = strip_code_fences(response.output_text)

    if not snippet.lower().startswith("curl "):
        snippet = f"curl {snippet.lstrip()}" if "curl" not in snippet.lower() else snippet

    ensure_output_dir()
    output_path.write_text(f"{snippet.rstrip()}\n")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Generate cURL snippets via the Responses API.")
    parser.add_argument("--force", "-f", action="store_true", help="Regenerate all snippets.")
    args = parser.parse_args()

    examples = load_examples()
    if not examples:
        print("No examples defined in curl_snippets.yaml; nothing to do.")
        return

    manifest = read_manifest()
    inlined_schemas = inline_all_schemas()
    client = AsyncOpenAI()
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    updated_manifest: Dict[str, str] = dict(manifest)

    async with asyncio.TaskGroup() as tg:
        for example in examples:
            schema_payloads = load_schema_dependencies(
                example["dependencies"],
                inlined_schemas,
            )
            digest_payload = {
                "name": example["name"],
                "description": example["description"],
                "metadata": example["metadata"],
                "dependencies": example["dependencies"],
            }
            digest = compute_digest(digest_payload, schema_payloads)

            output_path = OUTPUT_DIR / f"{example['name']}.sh"
            needs_update = (
                args.force
                or manifest.get(example["name"]) != digest
                or not output_path.exists()
            )

            if needs_update:
                tg.create_task(
                    generate_snippet(example, schema_payloads, output_path, client, sem)
                )

            updated_manifest[example["name"]] = digest

    write_manifest(updated_manifest)


if __name__ == "__main__":
    asyncio.run(main())
