import argparse
import json
from pathlib import Path
from typing import Any, Dict, List
import hashlib
import asyncio
import json.decoder

import openai
from openai import AsyncOpenAI

ROOT = Path(__file__).parent.parent
OPENAPI_PATH = ROOT / "public" / "openapi" / "openapi.json"
EXAMPLES_DIR = ROOT / "public" / "examples"

JSONValue = Any
SchemaMap = Dict[str, JSONValue]


def load_openapi() -> dict[str, Any]:
    return json.loads(OPENAPI_PATH.read_text())


def load_schemas(openapi_doc: dict[str, Any]) -> SchemaMap:
    components = openapi_doc.get("components")
    if not isinstance(components, dict):
        raise ValueError("OpenAPI document is missing 'components'.")
    schemas = components.get("schemas")
    if not isinstance(schemas, dict):
        raise ValueError("OpenAPI document is missing 'components.schemas'.")
    return schemas


def deep_clone(value: JSONValue) -> JSONValue:
    return json.loads(json.dumps(value))


def unescape_pointer_token(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def resolve_pointer(root: JSONValue, pointer: str) -> JSONValue:
    if pointer in ("", "#"):
        return deep_clone(root)

    if pointer.startswith("#"):
        pointer = pointer[1:]

    if not pointer.startswith("/"):
        raise ValueError(f"Unsupported JSON pointer format '{pointer}'")

    tokens = [unescape_pointer_token(token) for token in pointer[1:].split("/")]
    current: JSONValue = root
    for token in tokens:
        if isinstance(current, list):
            index = int(token)
            current = current[index]
        elif isinstance(current, dict):
            if token not in current:
                raise KeyError(f"Unable to resolve pointer segment '{token}'")
            current = current[token]
        else:
            raise KeyError(f"Unable to resolve pointer segment '{token}'")
    return deep_clone(current)


def inline_schema_internal(
    schema_name: str,
    schemas: SchemaMap,
    cache: Dict[str, JSONValue],
    stack: List[str],
) -> JSONValue:
    if schema_name in cache:
        cached = cache[schema_name]
        if not stack and isinstance(cached, dict) and "allOf" in cached:
            cache.pop(schema_name)
        else:
            return cached

    if schema_name in stack:
        cycle = " -> ".join([*stack, schema_name])
        raise ValueError(f"Circular $ref detected: {cycle}")

    schema = schemas.get(schema_name)
    if schema is None:
        raise KeyError(f"Missing schema for $ref '{schema_name}'")

    stack.append(schema_name)
    inlined = inline_node(schema, schema_name, schemas, cache, stack)
    inlined = ensure_object_additional_properties(inlined)
    stack.pop()
    cache[schema_name] = inlined
    return inlined


def resolve_ref(
    ref: str,
    current_schema: str,
    schemas: SchemaMap,
    cache: Dict[str, JSONValue],
    stack: List[str],
) -> JSONValue:
    path_part, _, pointer_part = ref.partition("#")
    target_schema = path_part or current_schema

    if pointer_part.startswith("/components/schemas/"):
        tokens = [unescape_pointer_token(token) for token in pointer_part.split("/") if token]
        # tokens: ["components", "schemas", "SchemaName", ...]
        if len(tokens) < 3:
            raise KeyError(f"Unable to resolve pointer '{pointer_part}'")
        schema_name = tokens[2]
        resolved_schema = deep_clone(
            inline_schema_internal(schema_name, schemas, cache, stack)
        )
        if len(tokens) == 3:
            return resolved_schema
        pointer = "/" + "/".join(tokens[3:])
        return resolve_pointer(resolved_schema, pointer)

    if target_schema in stack:
        return {"$ref": ref}

    resolved_schema = deep_clone(
        inline_schema_internal(target_schema, schemas, cache, stack)
    )

    if pointer_part == "":
        return resolved_schema

    pointer = pointer_part if pointer_part.startswith("/") else f"/{pointer_part}"
    return resolve_pointer(resolved_schema, pointer)


def inline_node(
    node: JSONValue,
    current_schema: str,
    schemas: SchemaMap,
    cache: Dict[str, JSONValue],
    stack: List[str],
) -> JSONValue:
    if isinstance(node, list):
        return [
            inline_node(item, current_schema, schemas, cache, stack) for item in node
        ]

    if isinstance(node, dict):
        ref_value = node.get("$ref")
        if isinstance(ref_value, str):
            rest = {key: value for key, value in node.items() if key != "$ref"}
            resolved = resolve_ref(ref_value, current_schema, schemas, cache, stack)
            if not rest:
                return resolved
            inlined_rest = inline_node(rest, current_schema, schemas, cache, stack)
            return {"allOf": [resolved, inlined_rest]}

        all_of = node.get("allOf")
        if isinstance(all_of, list):
            inlined = {
                key: inline_node(value, current_schema, schemas, cache, stack)
                for key, value in node.items()
                if key != "allOf"
            }
            inlined["allOf"] = [
                inline_node(segment, current_schema, schemas, cache, stack) for segment in all_of
            ]
            return inlined

        return {
            key: inline_node(value, current_schema, schemas, cache, stack)
            for key, value in node.items()
        }

    return deep_clone(node)


def inline_all_schemas() -> SchemaMap:
    openapi_doc = load_openapi()
    schemas = load_schemas(openapi_doc)
    cache: Dict[str, JSONValue] = {}
    result: SchemaMap = {}

    for schema_name in schemas:
        result[schema_name] = inline_schema_internal(schema_name, schemas, cache, [])

    return result


def ensure_object_additional_properties(node: JSONValue) -> JSONValue:
    if isinstance(node, list):
        return [ensure_object_additional_properties(item) for item in node]

    if isinstance(node, dict):
        processed: Dict[str, JSONValue] = {}
        for key, value in node.items():
            processed[key] = ensure_object_additional_properties(value)

        type_value = processed.get("type")
        is_object_type = False
        if isinstance(type_value, str):
            is_object_type = type_value == "object"
        elif isinstance(type_value, list):
            is_object_type = any(t == "object" for t in type_value if isinstance(t, str))

        if not is_object_type and (
            "properties" in processed or "patternProperties" in processed
        ):
            is_object_type = True

        if is_object_type and "additionalProperties" not in processed:
            processed["additionalProperties"] = False


        return processed

    return node


def schema_hash(schema: str) -> str:
    digest = hashlib.new("sha-1")
    digest.update(schema.encode('utf-8'))
    return digest.hexdigest()


def read_manifest() -> dict[str, str]:
    manifest_filepath = EXAMPLES_DIR / "manifest.json"
    if not manifest_filepath.exists():
        manifest_filepath.touch()
        return {}

    with open(manifest_filepath, 'r') as manifest_buffer:
        if len(manifest_buffer.read()) == 0:
            return {}

        manifest_buffer.seek(0)
        return json.load(manifest_buffer)

def write_manifest(manifest: dict[str, str]) -> None:
    with open(EXAMPLES_DIR/"manifest.json", 'w') as manifest_buffer:
        json.dump(manifest, manifest_buffer, indent=2)


INSTRUCTIONS = """
Your job is to generate json schema examples for objects in our API. Here are some things to keep in mind:

- Example generations should be readable and include enough context so readers can get a quick, at-a-glance overview of the object.
- When generating logprobs, don't be exhaustive. Just generate one to keep the example readable.
- Be VERY sure to generate a key for every required property. Super important
"""

def parse_json_output(payload: str) -> JSONValue:
    text = payload.strip()
    if not text:
        raise ValueError("Empty response output.")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        obj, _ = decoder.raw_decode(text)
        return obj

async def generate_schema_example(
    key: str,
    schema: dict[str, Any],
    openai_client: AsyncOpenAI,
    sema: asyncio.Semaphore,
    *,
    max_parse_attempts: int = 3,
) -> None:
    async with sema:
        print(f"generating {key}")
        parsed: JSONValue | None = None
        last_error: Exception | None = None

        for attempt in range(1, max_parse_attempts + 1):
            try:
                response = await openai_client.responses.create(
                    model="gpt-4.1-mini",
                    input="please create an example object of the following format",
                    store=False,
                    instructions=INSTRUCTIONS,
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "example_schema",
                            "strict": True,
                            "schema": schema
                        }
                    }
                )
            except openai.BadRequestError:
                print("Falling back to non-strict")
                response = await openai_client.responses.create(
                    model="gpt-4.1",
                    input="please create an example object of the following format",
                    store=False,
                    instructions=INSTRUCTIONS,
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "example_schema",
                            "strict": False,
                            "schema": schema
                        }
                    }
                )

            try:
                parsed = parse_json_output(response.output_text)
                break
            except Exception as e:
                last_error = e
                print(f"Failed to parse JSON for {key} (attempt {attempt}/{max_parse_attempts}): {e}")
                if attempt == max_parse_attempts:
                    return

        with open(f"{EXAMPLES_DIR / key}.json", 'w') as example_buffer:
            example_buffer.write(json.dumps(parsed, indent=2))

async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force" , "-f", action="store_true")
    parser.add_argument("-n", "--parallelism", type=int, default=5)

    parsed = parser.parse_args()

    schemas = inline_all_schemas()
    openai_client = AsyncOpenAI()
    manifest = read_manifest()
    sem = asyncio.Semaphore(max(1, parsed.parallelism))

    async with asyncio.TaskGroup() as tg:
        for key in sorted(schemas.keys()):
            schema = schemas.get(key)

            if schema.get("type") != "object":
                continue
            properties = schema.get("properties")
            if not isinstance(properties, dict) or len(properties) == 0:
                print(f"skipping {key} (empty object schema)")
                continue

            digest = schema_hash(json.dumps(schema, sort_keys=True))

            if parsed.force or key not in manifest or manifest.get(key) != digest or not (EXAMPLES_DIR/key).exists():
                tg.create_task(generate_schema_example(key, schema, openai_client, sem))

                manifest[key] = digest

        write_manifest(manifest)



if __name__ == "__main__":
    asyncio.run(main())
