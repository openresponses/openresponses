#!/usr/bin/env python3
"""
Bundle relative-file $ref values into a single OpenAPI/JSON-Schema document.

This script crawls an entrypoint JSON (or YAML, if PyYAML is installed) and
resolves relative-file references like:

  { "$ref": "../components/schemas/Foo.json#/properties/bar" }

Instead of literally inlining every $ref *usage* (which can bloat the output),
the default behavior is to "bundle" referenced component definitions into the
output under `#/components/...` and rewrite relative-file $refs to internal
`#/components/...` $refs. This preserves re-use across the spec.

As a fallback, relative-file $refs that do not point into a `components/<type>/`
folder are dereferenced at the usage site (e.g. `paths/*.json` includes).

Use `--mode inline` to force the old behavior (dereference every usage).
"""

import argparse
import hashlib
import json
import os
import re
import sys
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Union


Json = Union[dict[str, Any], list[Any], str, int, float, bool, None]


def _eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def _looks_like_url(ref: str) -> bool:
    return "://" in ref


def _split_ref(ref: str) -> tuple[str, str]:
    """
    Split a $ref into (path_part, fragment_part_without_hash).
    Examples:
      "foo.json#/a/b" -> ("foo.json", "/a/b")
      "foo.json"      -> ("foo.json", "")
      "#/a/b"         -> ("", "/a/b")
      "#"             -> ("", "")
    """
    if "#" not in ref:
        return ref, ""
    path, frag = ref.split("#", 1)
    return path, frag


def _decode_json_pointer_token(token: str) -> str:
    # JSON Pointer escaping per RFC 6901
    return token.replace("~1", "/").replace("~0", "~")


def _json_pointer_get(doc: Json, pointer: str, *, context: str) -> Json:
    """
    Resolve a JSON Pointer against a loaded document.
    pointer is the fragment part without '#'. "" means the whole doc.
    """
    if pointer in ("", None):
        return doc
    if not pointer.startswith("/"):
        raise ValueError(f"Unsupported JSON pointer fragment '{pointer}' in {context} (expected '' or '/...').")

    cur: Json = doc
    for raw_token in pointer.lstrip("/").split("/"):
        token = _decode_json_pointer_token(raw_token)
        if isinstance(cur, list):
            try:
                idx = int(token)
            except ValueError as e:
                raise KeyError(f"Pointer token '{token}' is not a list index in {context}.") from e
            try:
                cur = cur[idx]
            except IndexError as e:
                raise KeyError(f"List index '{idx}' out of range while resolving pointer in {context}.") from e
        elif isinstance(cur, dict):
            if token not in cur:
                raise KeyError(f"Key '{token}' not found while resolving pointer in {context}.")
            cur = cur[token]
        else:
            raise KeyError(f"Cannot dereference through non-container while resolving pointer in {context}.")
    return cur


def _load_document(path: Path) -> Json:
    suffix = path.suffix.lower()
    with path.open("r", encoding="utf-8") as f:
        if suffix in (".json",):
            return json.load(f)
        if suffix in (".yaml", ".yml"):
            try:
                import yaml  # type: ignore
            except Exception as e:  # pragma: no cover
                raise RuntimeError(
                    f"Cannot parse YAML file {path} because PyYAML is not installed. "
                    f"Either convert to JSON or install pyyaml."
                ) from e
            return yaml.safe_load(f)
        # Try JSON as a last resort.
        return json.load(f)


def _is_relative_file_ref(ref: str) -> bool:
    """
    True for refs that point to another file using a relative path.
    We intentionally exclude:
      - internal refs "#/..."
      - URLs "http(s)://..."
      - absolute paths "/abs/path" (unless you want to treat them as files too)
    """
    if not isinstance(ref, str) or ref == "":
        return False
    if ref.startswith("#"):
        return False
    if _looks_like_url(ref):
        return False
    path_part, _frag = _split_ref(ref)
    if path_part == "":
        return False
    # "foo.json" or "../foo.json" etc.
    return not os.path.isabs(path_part)


def _deep_merge(base: Json, overlay: Json) -> Json:
    """
    Merge overlay onto base (dict-only deep merge). Non-dicts are replaced.
    This is used to keep sibling keys alongside a $ref, e.g.:
      { "$ref": "x.json", "description": "..." }
    """
    if isinstance(base, dict) and isinstance(overlay, dict):
        out: dict[str, Any] = dict(base)
        for k, v in overlay.items():
            if k in out:
                out[k] = _deep_merge(out[k], v)
            else:
                out[k] = v
        return out
    return overlay


@dataclass(frozen=True)
class RefKey:
    abs_path: str
    pointer: str


class RefInliner:
    def __init__(
        self,
        *,
        inline_internal_refs: bool = False,
        on_cycle: str = "keep",
        max_depth: int = 200,
    ) -> None:
        self.inline_internal_refs = inline_internal_refs
        self.on_cycle = on_cycle
        self.max_depth = max_depth
        self._doc_cache: dict[str, Json] = {}
        self._cycle_warnings_emitted: set[tuple[str, str]] = set()

    def _load_cached(self, abs_path: Path) -> Json:
        key = str(abs_path)
        if key not in self._doc_cache:
            self._doc_cache[key] = _load_document(abs_path)
        return self._doc_cache[key]

    def inline(self, entrypoint: Path) -> Json:
        entry_abs = entrypoint.resolve()
        doc = self._load_cached(entry_abs)
        return self._inline_node(deepcopy(doc), base_file=entry_abs, stack=[], depth=0)

    def resolve_ref(self, ref_value: str, *, base_file: Path) -> tuple[Json, Path]:
        """
        Resolve a $ref to its target node without recursively inlining the target's
        own $refs.

        Returns (resolved_node, resolved_base_file) where resolved_base_file is the
        file that should be used as the base for resolving *relative-file* $refs
        inside resolved_node.
        """
        path_part, frag = _split_ref(ref_value)

        if path_part == "":
            loaded = self._load_cached(base_file.resolve())
            target = _json_pointer_get(loaded, frag, context=f"$ref '{ref_value}' from {base_file}")
            return deepcopy(target), base_file.resolve()

        abs_path = (base_file.parent / path_part).resolve()
        loaded = self._load_cached(abs_path)
        target = _json_pointer_get(loaded, frag, context=f"$ref '{ref_value}' from {base_file}")
        return deepcopy(target), abs_path

    def _inline_ref_value(
        self,
        ref_value: str,
        *,
        base_file: Path,
        stack: list[RefKey],
        depth: int,
    ) -> Json:
        path_part, frag = _split_ref(ref_value)

        # Internal refs: optionally inline, but they are not "relative schemas".
        if path_part == "":
            if not self.inline_internal_refs:
                return {"$ref": ref_value}
            # Resolve within the current document.
            abs_path = base_file.resolve()
            key = RefKey(str(abs_path), frag)
        else:
            abs_path = (base_file.parent / path_part).resolve()
            key = RefKey(str(abs_path), frag)

        if key in stack:
            msg = f"Cycle detected while resolving $ref '{ref_value}' from {base_file}."
            if self.on_cycle == "keep":
                warn_key = (str(base_file.resolve()), ref_value)
                if warn_key not in self._cycle_warnings_emitted:
                    self._cycle_warnings_emitted.add(warn_key)
                    _eprint(f"warning: {msg} Keeping original $ref.")
                return {"$ref": ref_value}
            raise RuntimeError(msg)

        if depth > self.max_depth:
            raise RuntimeError(
                f"Max depth exceeded ({self.max_depth}) while resolving $ref '{ref_value}' from {base_file}."
            )

        loaded = self._load_cached(Path(key.abs_path))
        try:
            target = _json_pointer_get(loaded, key.pointer, context=f"$ref '{ref_value}' from {base_file}")
        except Exception as e:
            raise RuntimeError(f"Failed to resolve $ref '{ref_value}' from {base_file}: {e}") from e

        # Important: deepcopy to prevent mutation across multiple expansions.
        inlined = self._inline_node(deepcopy(target), base_file=Path(key.abs_path), stack=stack + [key], depth=depth + 1)
        return inlined

    def _inline_node(self, node: Json, *, base_file: Path, stack: list[RefKey], depth: int) -> Json:
        if isinstance(node, dict):
            if "$ref" in node and isinstance(node.get("$ref"), str):
                ref_value = node["$ref"]

                if _is_relative_file_ref(ref_value) or (self.inline_internal_refs and ref_value.startswith("#")):
                    siblings = {k: v for k, v in node.items() if k != "$ref"}
                    resolved = self._inline_ref_value(ref_value, base_file=base_file, stack=stack, depth=depth)
                    if siblings:
                        # Resolve siblings against the current base file (the container), not the referenced file.
                        siblings_inlined = self._inline_node(siblings, base_file=base_file, stack=stack, depth=depth + 1)
                        if isinstance(resolved, dict) and isinstance(siblings_inlined, dict):
                            return _deep_merge(resolved, siblings_inlined)
                        # If types conflict, let siblings win (best-effort).
                        return siblings_inlined
                    return resolved

                # Non-relative refs are left intact, but we still should inline inside siblings (if any).
                out: dict[str, Any] = {}
                for k, v in node.items():
                    if k == "$ref":
                        out[k] = v
                    else:
                        out[k] = self._inline_node(v, base_file=base_file, stack=stack, depth=depth + 1)
                return out

            # Regular dict: recurse all values.
            return {k: self._inline_node(v, base_file=base_file, stack=stack, depth=depth + 1) for k, v in node.items()}

        if isinstance(node, list):
            return [self._inline_node(v, base_file=base_file, stack=stack, depth=depth + 1) for v in node]

        return node


_OPENAPI_COMPONENT_KEYS: set[str] = {
    "schemas",
    "responses",
    "parameters",
    "examples",
    "requestBodies",
    "headers",
    "securitySchemes",
    "links",
    "callbacks",
}


def _component_group_for_abs_path(abs_path: Path) -> Optional[str]:
    """
    If abs_path looks like ".../components/<group>/Foo.json", return "<group>".

    This repo's OpenAPI output (TypeSpec) uses file refs for components like:
      ../components/schemas/Foo.json

    We use this to decide which refs can be hoisted into #/components/<group>/...
    while keeping the document OpenAPI-valid.
    """
    parts = abs_path.parts
    try:
        idx = parts.index("components")
    except ValueError:
        return None
    if idx + 1 >= len(parts):
        return None
    group = parts[idx + 1]
    return group if group in _OPENAPI_COMPONENT_KEYS else None


def _sanitize_component_name(name: str) -> str:
    # Component keys are fairly permissive, but keep names conservative to avoid tool quirks.
    name = re.sub(r"[^A-Za-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name or "Ref"


def _make_component_base_name(abs_path: Path, pointer: str) -> str:
    stem = abs_path.stem
    if pointer in ("", None):
        base = stem
    else:
        tokens = [_decode_json_pointer_token(t) for t in pointer.lstrip("/").split("/") if t != ""]
        # Keep pointer-derived names readable but bounded.
        tokens = tokens[:8]
        base = stem + "__" + "__".join(tokens) if tokens else stem
    base = _sanitize_component_name(base)
    return base


class RefBundler:
    """
    Rewrite relative-file refs to internal `#/components/...` refs and hoist the
    referenced definitions into the output. This avoids duplicating schemas at
    every $ref usage.
    """

    def __init__(
        self,
        *,
        inline_internal_refs: bool = False,
        on_cycle: str = "keep",
        max_depth: int = 200,
    ) -> None:
        self.inline_internal_refs = inline_internal_refs
        self.on_cycle = on_cycle
        self.max_depth = max_depth
        self._doc_cache: dict[str, Json] = {}
        self._cycle_warnings_emitted: set[tuple[str, str]] = set()

        # RefKey -> (component_group, component_name)
        self._ref_map: dict[RefKey, tuple[str, str]] = {}
        self._in_progress: set[RefKey] = set()
        self._bundled_components: dict[str, dict[str, Any]] = {}
        self._reserved_component_names: dict[str, set[str]] = {}

    def reserve_existing_components(self, doc: Json) -> None:
        """
        Reserve any existing component names so we avoid clobbering them while bundling.

        This is primarily useful when the entrypoint already includes inline component
        definitions (rare in this repo, but possible).
        """
        if not isinstance(doc, dict):
            return
        components = doc.get("components")
        if not isinstance(components, dict):
            return
        for group in _OPENAPI_COMPONENT_KEYS:
            group_obj = components.get(group)
            if isinstance(group_obj, dict):
                self._reserved_component_names.setdefault(group, set()).update(group_obj.keys())

    def _load_cached(self, abs_path: Path) -> Json:
        key = str(abs_path)
        if key not in self._doc_cache:
            self._doc_cache[key] = _load_document(abs_path)
        return self._doc_cache[key]

    def resolve_ref(self, ref_value: str, *, base_file: Path) -> tuple[Json, Path]:
        """
        Resolve a $ref to its target node without recursively bundling the target's
        own $refs.

        Returns (resolved_node, resolved_base_file) where resolved_base_file is the
        file that should be used as the base for resolving *relative-file* $refs
        inside resolved_node.
        """
        path_part, frag = _split_ref(ref_value)

        if path_part == "":
            loaded = self._load_cached(base_file.resolve())
            target = _json_pointer_get(loaded, frag, context=f"$ref '{ref_value}' from {base_file}")
            return deepcopy(target), base_file.resolve()

        abs_path = (base_file.parent / path_part).resolve()
        loaded = self._load_cached(abs_path)
        target = _json_pointer_get(loaded, frag, context=f"$ref '{ref_value}' from {base_file}")
        return deepcopy(target), abs_path

    def _internal_ref_for(self, group: str, name: str) -> str:
        return f"#/components/{group}/{name}"

    def _bundle_component_ref(
        self,
        ref_value: str,
        *,
        base_file: Path,
        stack: list[RefKey],
        depth: int,
    ) -> str:
        path_part, frag = _split_ref(ref_value)
        abs_path = (base_file.parent / path_part).resolve()
        group = _component_group_for_abs_path(abs_path)
        if group is None:
            raise RuntimeError(f"Internal error: attempted to bundle non-component ref: {ref_value!r} from {base_file}")

        key = RefKey(str(abs_path), frag)

        if key in self._ref_map:
            g, n = self._ref_map[key]
            return self._internal_ref_for(g, n)

        # Break recursion while a definition is being computed.
        if key in self._in_progress:
            g, n = self._ref_map.get(key, (group, _make_component_base_name(abs_path, frag)))
            return self._internal_ref_for(g, n)

        if key in stack:
            msg = f"Cycle detected while resolving $ref '{ref_value}' from {base_file}."
            if self.on_cycle == "keep":
                warn_key = (str(base_file.resolve()), ref_value)
                if warn_key not in self._cycle_warnings_emitted:
                    self._cycle_warnings_emitted.add(warn_key)
                    _eprint(f"warning: {msg} Keeping original $ref.")
                return ref_value
            raise RuntimeError(msg)

        if depth > self.max_depth:
            raise RuntimeError(
                f"Max depth exceeded ({self.max_depth}) while resolving $ref '{ref_value}' from {base_file}."
            )

        base_name = _make_component_base_name(abs_path, frag)
        name = base_name
        # Prefer readable names (file stems) but avoid collisions with existing or already-bundled defs.
        reserved = self._reserved_component_names.get(group, set())
        group_map = self._bundled_components.setdefault(group, {})
        if name in reserved or name in group_map:
            h = hashlib.sha1(f"{abs_path.as_posix()}#{frag}".encode("utf-8")).hexdigest()[:10]
            name = f"{base_name}__{h}"
            if name in reserved or name in group_map:
                # Very unlikely, but keep trying deterministically.
                name = f"{base_name}__{h}__2"
        self._ref_map[key] = (group, name)
        self._in_progress.add(key)

        loaded = self._load_cached(abs_path)
        try:
            target = _json_pointer_get(loaded, frag, context=f"$ref '{ref_value}' from {base_file}")
        except Exception as e:
            raise RuntimeError(f"Failed to resolve $ref '{ref_value}' from {base_file}: {e}") from e

        bundled = self._bundle_node(deepcopy(target), base_file=abs_path, stack=stack + [key], depth=depth + 1)

        if name in group_map and group_map[name] != bundled:
            # Extremely unlikely due to hash suffix, but avoid silently clobbering.
            raise RuntimeError(
                f"Component name collision for {name!r} while bundling {ref_value!r} from {base_file}."
            )
        group_map[name] = bundled
        self._in_progress.remove(key)
        return self._internal_ref_for(group, name)

    def _bundle_node(self, node: Json, *, base_file: Path, stack: list[RefKey], depth: int) -> Json:
        if isinstance(node, dict):
            if "$ref" in node and isinstance(node.get("$ref"), str):
                ref_value = node["$ref"]

                if ref_value.startswith("#") and self.inline_internal_refs:
                    # Inline within the current document, then keep bundling within the result.
                    inliner = RefInliner(
                        inline_internal_refs=True,
                        on_cycle=self.on_cycle,
                        max_depth=self.max_depth,
                    )
                    inliner._doc_cache = self._doc_cache
                    resolved = inliner._inline_ref_value(ref_value, base_file=base_file, stack=[], depth=depth)
                    return self._bundle_node(resolved, base_file=base_file, stack=stack, depth=depth + 1)

                if _is_relative_file_ref(ref_value):
                    path_part, _frag = _split_ref(ref_value)
                    abs_path = (base_file.parent / path_part).resolve()
                    group = _component_group_for_abs_path(abs_path)
                    siblings = {k: v for k, v in node.items() if k != "$ref"}

                    if group is not None:
                        internal_ref = self._bundle_component_ref(
                            ref_value, base_file=base_file, stack=stack, depth=depth
                        )
                        if not siblings:
                            return {"$ref": internal_ref}

                        # Avoid emitting sibling keys next to $ref in Schema Objects.
                        if group == "schemas":
                            siblings_bundled = self._bundle_node(
                                siblings, base_file=base_file, stack=stack, depth=depth + 1
                            )
                            if not isinstance(siblings_bundled, dict):
                                raise RuntimeError("Internal error: schema siblings should bundle to an object.")
                            return {"allOf": [{"$ref": internal_ref}, siblings_bundled]}

                        # Non-schema component refs with siblings: preserve old behavior by inlining at usage site.
                        resolved, resolved_base_file = self.resolve_ref(ref_value, base_file=base_file)
                        resolved_bundled = self._bundle_node(
                            resolved, base_file=resolved_base_file, stack=stack, depth=depth + 1
                        )
                        siblings_bundled = self._bundle_node(
                            siblings, base_file=base_file, stack=stack, depth=depth + 1
                        )
                        if isinstance(resolved_bundled, dict) and isinstance(siblings_bundled, dict):
                            return _deep_merge(resolved_bundled, siblings_bundled)
                        return siblings_bundled

                    # Non-component relative-file ref (e.g. paths/*.json). Dereference at usage site.
                    resolved, resolved_base_file = self.resolve_ref(ref_value, base_file=base_file)
                    resolved_bundled = self._bundle_node(
                        resolved, base_file=resolved_base_file, stack=stack, depth=depth + 1
                    )
                    if not siblings:
                        return resolved_bundled
                    siblings_bundled = self._bundle_node(siblings, base_file=base_file, stack=stack, depth=depth + 1)
                    if isinstance(resolved_bundled, dict) and isinstance(siblings_bundled, dict):
                        return _deep_merge(resolved_bundled, siblings_bundled)
                    return siblings_bundled

                # Non-relative refs are left intact, but we still bundle inside siblings (if any).
                out: dict[str, Any] = {}
                for k, v in node.items():
                    if k == "$ref":
                        out[k] = v
                    else:
                        out[k] = self._bundle_node(v, base_file=base_file, stack=stack, depth=depth + 1)
                return out

            return {
                k: self._bundle_node(v, base_file=base_file, stack=stack, depth=depth + 1) for k, v in node.items()
            }

        if isinstance(node, list):
            return [self._bundle_node(v, base_file=base_file, stack=stack, depth=depth + 1) for v in node]

        return node

    def bundle(self, entrypoint: Path) -> Json:
        entry_abs = entrypoint.resolve()
        doc = self._load_cached(entry_abs)
        self.reserve_existing_components(doc)
        out = self._bundle_node(deepcopy(doc), base_file=entry_abs, stack=[], depth=0)
        if not isinstance(out, dict):
            return out

        if self._bundled_components:
            components = out.get("components")
            if components is None:
                components = {}
                out["components"] = components
            if not isinstance(components, dict):
                raise RuntimeError("Top-level 'components' exists but is not an object; cannot bundle components.")

            for group, defs in self._bundled_components.items():
                group_obj = components.get(group)
                if group_obj is None:
                    components[group] = dict(defs)
                else:
                    if not isinstance(group_obj, dict):
                        raise RuntimeError(f"components.{group} exists but is not an object; cannot merge bundled defs.")
                    for name, val in defs.items():
                        if name in group_obj and group_obj[name] != val:
                            raise RuntimeError(f"Bundled component {group}/{name} conflicts with existing definition.")
                        group_obj[name] = val
        return out


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Bundle or inline relative-file $ref schemas starting from an OpenAPI/JSON-Schema entrypoint."
    )
    p.add_argument(
        "entrypoint_pos",
        nargs="?",
        help="Path to the entrypoint JSON/YAML file (positional, optional if --entrypoint is provided).",
    )
    p.add_argument(
        "--entrypoint",
        default=None,
        help="Path to the entrypoint JSON/YAML file.",
    )
    p.add_argument(
        "--endpoint",
        action="append",
        default=[],
        help='Selectively include and process only this endpoint in the form "METHOD /path". '
        "Can be repeated. If omitted, the entire entrypoint is processed.",
    )
    p.add_argument(
        "-o",
        "--output",
        help="Write output to this file (default: stdout).",
        default=None,
    )
    p.add_argument(
        "--no-pretty",
        action="store_true",
        help="Emit compact JSON instead of pretty-printed output.",
    )
    p.add_argument(
        "--mode",
        choices=["bundle", "inline"],
        default="bundle",
        help=(
            "How to handle relative-file $refs. "
            "'bundle' (default) hoists referenced component definitions into the output under #/components/... "
            "and rewrites relative-file $refs to internal refs. "
            "'inline' dereferences every usage (older behavior)."
        ),
    )
    p.add_argument(
        "--inline-internal-refs",
        action="store_true",
        help="Also inline internal refs like '#/components/...'. (Default: leave internal refs as-is.)",
    )
    p.add_argument(
        "--manifest",
        default=None,
        help=(
            "Optional path to a JSON/YAML manifest that denylists component schema types and/or fields to omit "
            "from the final output."
        ),
    )
    p.add_argument(
        "--patches",
        default=None,
        help=(
            "Optional path to a JSON/YAML patch file that adds schemas, enum values, or schema list entries "
            "(oneOf/anyOf/allOf) to the final output."
        ),
    )
    p.add_argument(
        "--on-cycle",
        choices=["error", "keep"],
        default="keep",
        help="What to do if a $ref cycle is detected.",
    )
    p.add_argument(
        "--max-depth",
        type=int,
        default=200,
        help="Maximum recursion depth while expanding refs.",
    )
    return p.parse_args(argv)


_OPENAPI_METHOD_KEYS: set[str] = {
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace",
}


def _parse_endpoint_spec(spec: str) -> tuple[str, str]:
    parts = spec.strip().split(None, 1)
    if len(parts) != 2:
        raise ValueError(f'Invalid --endpoint value {spec!r}. Expected format: "METHOD /path".')
    method = parts[0].strip().lower()
    path = parts[1].strip()
    if method not in _OPENAPI_METHOD_KEYS:
        raise ValueError(f"Invalid HTTP method {parts[0]!r} in --endpoint {spec!r}.")
    if not path.startswith("/"):
        raise ValueError(f"Invalid path {path!r} in --endpoint {spec!r} (expected it to start with '/').")
    return method, path


def _selective_megaspec(entry_doc: Json, *, entry_file: Path, inliner: RefInliner, endpoints: list[str]) -> Json:
    if not isinstance(entry_doc, dict):
        raise RuntimeError("Entrypoint document must be an object at the top-level for selective endpoint mode.")

    paths_obj = entry_doc.get("paths")
    if not isinstance(paths_obj, dict):
        raise RuntimeError("Entrypoint document must have a top-level 'paths' object for selective endpoint mode.")

    # Preserve everything except 'paths', which we rebuild.
    out: dict[str, Any] = {k: deepcopy(v) for k, v in entry_doc.items() if k != "paths"}
    out_paths: dict[str, Any] = {}

    for spec in endpoints:
        method, path = _parse_endpoint_spec(spec)
        if path not in paths_obj:
            raise RuntimeError(f"Path {path!r} not found in entrypoint 'paths'.")

        path_entry = paths_obj[path]
        path_base_file = entry_file.resolve()

        # Common OpenAPI pattern: paths: { "/x": { "$ref": "paths/x.json" } }
        if isinstance(path_entry, dict) and isinstance(path_entry.get("$ref"), str):
            ref_value = path_entry["$ref"]
            if _looks_like_url(ref_value):
                raise RuntimeError(f"URL $ref not supported for selective endpoint mode: {ref_value!r}")
            path_entry, path_base_file = inliner.resolve_ref(ref_value, base_file=entry_file)

        if not isinstance(path_entry, dict):
            raise RuntimeError(f"Path item for {path!r} must be an object (got {type(path_entry).__name__}).")

        op_obj = path_entry.get(method)
        if not isinstance(op_obj, dict):
            raise RuntimeError(f"Method {method.upper()} not found for path {path!r}.")

        # Initialize path item in output, preserving pathItem-level keys like 'parameters'.
        existing = out_paths.get(path)
        if existing is None:
            path_item_out: dict[str, Any] = {}
            for k, v in path_entry.items():
                if k in _OPENAPI_METHOD_KEYS:
                    continue
                path_item_out[k] = inliner._inline_node(deepcopy(v), base_file=path_base_file, stack=[], depth=0)
            out_paths[path] = path_item_out
        else:
            if not isinstance(existing, dict):
                raise RuntimeError(f"Internal error: output path item for {path!r} is not an object.")

        # Inline all relative refs inside the operation.
        out_op = inliner._inline_node(deepcopy(op_obj), base_file=path_base_file, stack=[], depth=0)
        out_paths[path][method] = out_op

    out["paths"] = out_paths
    return out


def _selective_megaspec_bundle(entry_doc: Json, *, entry_file: Path, bundler: RefBundler, endpoints: list[str]) -> Json:
    if not isinstance(entry_doc, dict):
        raise RuntimeError("Entrypoint document must be an object at the top-level for selective endpoint mode.")

    bundler.reserve_existing_components(entry_doc)

    paths_obj = entry_doc.get("paths")
    if not isinstance(paths_obj, dict):
        raise RuntimeError("Entrypoint document must have a top-level 'paths' object for selective endpoint mode.")

    # Preserve everything except 'paths', which we rebuild. Preserve 'components' too; we will merge bundled defs in.
    out: dict[str, Any] = {k: deepcopy(v) for k, v in entry_doc.items() if k != "paths"}
    out_paths: dict[str, Any] = {}

    for spec in endpoints:
        method, path = _parse_endpoint_spec(spec)
        if path not in paths_obj:
            raise RuntimeError(f"Path {path!r} not found in entrypoint 'paths'.")

        path_entry = paths_obj[path]
        path_base_file = entry_file.resolve()

        # Common OpenAPI pattern: paths: { "/x": { "$ref": "paths/x.json" } }
        if isinstance(path_entry, dict) and isinstance(path_entry.get("$ref"), str):
            ref_value = path_entry["$ref"]
            if _looks_like_url(ref_value):
                raise RuntimeError(f"URL $ref not supported for selective endpoint mode: {ref_value!r}")
            path_entry, path_base_file = bundler.resolve_ref(ref_value, base_file=entry_file)

        if not isinstance(path_entry, dict):
            raise RuntimeError(f"Path item for {path!r} must be an object (got {type(path_entry).__name__}).")

        op_obj = path_entry.get(method)
        if not isinstance(op_obj, dict):
            raise RuntimeError(f"Method {method.upper()} not found for path {path!r}.")

        # Initialize path item in output, preserving pathItem-level keys like 'parameters'.
        existing = out_paths.get(path)
        if existing is None:
            path_item_out: dict[str, Any] = {}
            for k, v in path_entry.items():
                if k in _OPENAPI_METHOD_KEYS:
                    continue
                path_item_out[k] = bundler._bundle_node(deepcopy(v), base_file=path_base_file, stack=[], depth=0)
            out_paths[path] = path_item_out
        else:
            if not isinstance(existing, dict):
                raise RuntimeError(f"Internal error: output path item for {path!r} is not an object.")

        out_op = bundler._bundle_node(deepcopy(op_obj), base_file=path_base_file, stack=[], depth=0)
        out_paths[path][method] = out_op

    out["paths"] = out_paths

    # Merge any bundled component definitions required by the selected endpoints.
    if bundler._bundled_components:
        components = out.get("components")
        if components is None:
            components = {}
            out["components"] = components
        if not isinstance(components, dict):
            raise RuntimeError("Top-level 'components' exists but is not an object; cannot bundle components.")
        for group, defs in bundler._bundled_components.items():
            group_obj = components.get(group)
            if group_obj is None:
                components[group] = dict(defs)
            else:
                if not isinstance(group_obj, dict):
                    raise RuntimeError(f"components.{group} exists but is not an object; cannot merge bundled defs.")
                for name, val in defs.items():
                    if name in group_obj and group_obj[name] != val:
                        raise RuntimeError(f"Bundled component {group}/{name} conflicts with existing definition.")
                    group_obj[name] = val

    return out


def _strip_x_properties(node: Json, *, keep_keys: set[str] | None = None) -> Json:
    """
    Remove vendor-extension keys (OpenAPI-style) from all objects.
    Any object property whose key starts with 'x-' is removed recursively.
    """
    if isinstance(node, list):
        return [_strip_x_properties(v, keep_keys=keep_keys) for v in node]
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            if isinstance(k, str) and k.startswith("x-"):
                if keep_keys and k in keep_keys:
                    out[k] = _strip_x_properties(v, keep_keys=keep_keys)
                continue
            out[k] = _strip_x_properties(v, keep_keys=keep_keys)
        return out
    return node


def _load_manifest(path: Path) -> dict[str, Any]:
    raw = _load_document(path)
    if not isinstance(raw, dict):
        raise RuntimeError(f"Manifest must be a JSON/YAML object at top-level (got {type(raw).__name__}).")
    return raw


def _load_additive_patches(path: Path) -> dict[str, Any]:
    raw = _load_document(path)
    if not isinstance(raw, dict):
        raise RuntimeError(f"Patches must be a JSON/YAML object at top-level (got {type(raw).__name__}).")
    version = raw.get("version", 1)
    if version != 1:
        raise RuntimeError(f"Unsupported patches version {version!r}; expected 1.")
    return raw


def _get_manifest_roots(manifest: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    allow = manifest.get("allow")
    deny = manifest.get("deny")

    if allow is None and deny is None:
        # Backwards compatibility: treat the whole manifest as the deny root.
        deny = manifest
        allow = {}

    if allow is None:
        allow = {}
    if deny is None:
        deny = {}

    if not isinstance(allow, dict) or not isinstance(deny, dict):
        raise RuntimeError("Manifest allow/deny must be objects if provided.")

    return allow, deny


def _normalize_string_list(values: list[Any], *, label: str) -> list[str]:
    out: list[str] = []
    for v in values:
        if v is None:
            continue
        if not isinstance(v, str):
            raise RuntimeError(f"Manifest {label} must be a list of strings.")
        v = v.strip()
        if not v:
            continue
        out.append(v)
    return out


def _get_manifest_types(manifest: dict[str, Any]) -> tuple[set[str], set[str]]:
    allow_root, deny_root = _get_manifest_roots(manifest)

    allow_types = allow_root.get("types", [])
    deny_types = deny_root.get("types", [])

    if allow_types is None:
        allow_types = []
    if deny_types is None:
        deny_types = []

    if not isinstance(allow_types, list):
        raise RuntimeError("Manifest allow.types must be a list of strings.")
    if not isinstance(deny_types, list):
        raise RuntimeError("Manifest deny.types must be a list of strings.")

    return set(_normalize_string_list(allow_types, label="allow.types")), set(
        _normalize_string_list(deny_types, label="deny.types")
    )


def _parse_field_map(value: Any, *, label: str) -> dict[str, list[list[str]]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RuntimeError(f"Manifest {label} must be an object mapping type name -> list of field paths.")

    out: dict[str, list[list[str]]] = {}
    for tname, paths in value.items():
        if not isinstance(tname, str):
            raise RuntimeError(f"Manifest {label} keys must be strings (type names).")
        if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
            raise RuntimeError(f"Manifest {label}.{tname} must be a list of strings.")
        segs: list[list[str]] = []
        for p in paths:
            # Dot-path into object properties (e.g. "usage.total_tokens").
            parts = [x for x in p.split(".") if x != ""]
            if not parts:
                continue
            segs.append(parts)
        out[tname] = segs
    return out


def _get_manifest_fields(manifest: dict[str, Any]) -> tuple[dict[str, list[list[str]]], dict[str, list[list[str]]]]:
    allow_root, deny_root = _get_manifest_roots(manifest)
    allow_fields = _parse_field_map(allow_root.get("fields"), label="allow.fields")
    deny_fields = _parse_field_map(deny_root.get("fields"), label="deny.fields")
    return allow_fields, deny_fields


def _parse_enum_map(value: Any, *, label: str) -> dict[str, list[tuple[Optional[list[str]], list[str]]]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RuntimeError(f"Manifest {label} must be an object mapping type name -> list of enum values.")

    out: dict[str, list[tuple[Optional[list[str]], list[str]]]] = {}
    for owner, values in value.items():
        if not isinstance(owner, str):
            raise RuntimeError(f"Manifest {label} keys must be strings (type names).")
        if not isinstance(values, list):
            raise RuntimeError(f"Manifest {label}.{owner} must be a list of strings.")
        parts = [p for p in owner.split(".") if p != ""]
        if not parts:
            raise RuntimeError(f"Manifest {label} keys must be non-empty strings.")
        type_name = parts[0]
        path = parts[1:] or None
        normalized = _normalize_string_list(values, label=f"{label}.{owner}")
        out.setdefault(type_name, []).append((path, normalized))
    return out


def _get_manifest_enums(
    manifest: dict[str, Any],
) -> tuple[
    dict[str, list[tuple[Optional[list[str]], list[str]]]],
    dict[str, list[tuple[Optional[list[str]], list[str]]]],
]:
    allow_root, deny_root = _get_manifest_roots(manifest)
    allow_enums = _parse_enum_map(allow_root.get("enums"), label="allow.enums")
    deny_enums = _parse_enum_map(deny_root.get("enums"), label="deny.enums")
    return allow_enums, deny_enums


def _parse_description_map(value: Any, *, label: str) -> dict[str, list[tuple[Optional[list[str]], Optional[str]]]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RuntimeError(f"Manifest {label} must be an object mapping type name -> description string.")

    out: dict[str, list[tuple[Optional[list[str]], Optional[str]]]] = {}
    for owner, desc in value.items():
        if not isinstance(owner, str):
            raise RuntimeError(f"Manifest {label} keys must be strings (type names).")
        if desc is not None and not isinstance(desc, str):
            raise RuntimeError(f"Manifest {label}.{owner} must be a string or null.")
        parts = [p for p in owner.split(".") if p != ""]
        if not parts:
            raise RuntimeError(f"Manifest {label} keys must be non-empty strings.")
        type_name = parts[0]
        path = parts[1:] or None
        out.setdefault(type_name, []).append((path, desc))
    return out


def _get_manifest_descriptions(
    manifest: dict[str, Any],
) -> tuple[
    dict[str, list[tuple[Optional[list[str]], Optional[str]]]],
    dict[str, list[tuple[Optional[list[str]], Optional[str]]]],
]:
    allow_root, deny_root = _get_manifest_roots(manifest)
    allow_desc = _parse_description_map(allow_root.get("descriptions"), label="allow.descriptions")
    deny_desc = _parse_description_map(deny_root.get("descriptions"), label="deny.descriptions")
    return allow_desc, deny_desc


def _parse_oneof_map(
    value: Any, *, label: str
) -> tuple[
    dict[str, list[tuple[Optional[list[str]], set[str]]]],
    list[tuple[str, str, list[str], set[str]]],
]:
    if value is None:
        return {}, []
    if not isinstance(value, dict):
        raise RuntimeError(f"Manifest {label} must be an object mapping type name -> list of type names.")

    out: dict[str, list[tuple[Optional[list[str]], set[str]]]] = {}
    path_rules: list[tuple[str, str, list[str], set[str]]] = []
    for owner, targets in value.items():
        if not isinstance(owner, str):
            raise RuntimeError(f"Manifest {label} keys must be strings (type names).")
        if not isinstance(targets, list):
            raise RuntimeError(f"Manifest {label}.{owner} must be a list of strings.")
        if owner.startswith("paths."):
            # paths.METHOD /path.responses.200.content.text/event-stream.schema
            rest = owner[len("paths.") :]
            parts = [p for p in rest.split(".") if p != ""]
            if len(parts) < 2:
                raise RuntimeError(f"Manifest {label} path rules must include a target path: {owner!r}.")
            method_path = parts[0]
            method, path = _parse_endpoint_spec(method_path)
            path_rules.append(
                (
                    method,
                    path,
                    parts[1:],
                    set(_normalize_string_list(targets, label=f"{label}.{owner}")),
                )
            )
            continue

        parts = [p for p in owner.split(".") if p != ""]
        if not parts:
            raise RuntimeError(f"Manifest {label} keys must be non-empty strings.")
        type_name = parts[0]
        path = parts[1:] or None
        out.setdefault(type_name, []).append((path, set(_normalize_string_list(targets, label=f"{label}.{owner}"))))
    return out, path_rules


def _get_manifest_oneof(
    manifest: dict[str, Any],
) -> tuple[
    dict[str, list[tuple[Optional[list[str]], set[str]]]],
    dict[str, list[tuple[Optional[list[str]], set[str]]]],
    list[tuple[str, str, list[str], set[str]]],
    list[tuple[str, str, list[str], set[str]]],
]:
    allow_root, deny_root = _get_manifest_roots(manifest)
    allow_oneof, allow_path_rules = _parse_oneof_map(allow_root.get("oneOf"), label="allow.oneOf")
    deny_oneof, deny_path_rules = _parse_oneof_map(deny_root.get("oneOf"), label="deny.oneOf")
    return allow_oneof, deny_oneof, allow_path_rules, deny_path_rules


def _node_contains_ref_to_type(node: Json, *, type_name: str) -> bool:
    ref = f"#/components/schemas/{type_name}"
    if isinstance(node, dict):
        if node.get("$ref") == ref:
            return True
        for v in node.values():
            if _node_contains_ref_to_type(v, type_name=type_name):
                return True
    elif isinstance(node, list):
        for v in node:
            if _node_contains_ref_to_type(v, type_name=type_name):
                return True
    return False


def _oneof_item_matches_type(item: Json, *, type_name: str) -> bool:
    return _node_contains_ref_to_type(item, type_name=type_name)


def _filter_oneof_lists(node: Json, *, remove_types: set[str]) -> Json:
    if isinstance(node, list):
        return [_filter_oneof_lists(v, remove_types=remove_types) for v in node]
    if not isinstance(node, dict):
        return node

    out: dict[str, Any] = {}
    for k, v in node.items():
        if k == "oneOf" and isinstance(v, list):
            filtered: list[Json] = []
            for item in v:
                if any(_oneof_item_matches_type(item, type_name=t) for t in remove_types):
                    continue
                filtered.append(_filter_oneof_lists(item, remove_types=remove_types))
            out[k] = filtered
            continue
        out[k] = _filter_oneof_lists(v, remove_types=remove_types)
    return out


def _filter_oneof_lists_allow(node: Json, *, keep_types: set[str]) -> Json:
    if isinstance(node, list):
        return [_filter_oneof_lists_allow(v, keep_types=keep_types) for v in node]
    if not isinstance(node, dict):
        return node

    out: dict[str, Any] = {}
    for k, v in node.items():
        if k == "oneOf" and isinstance(v, list):
            filtered: list[Json] = []
            for item in v:
                if not any(_oneof_item_matches_type(item, type_name=t) for t in keep_types):
                    continue
                filtered.append(_filter_oneof_lists_allow(item, keep_types=keep_types))
            out[k] = filtered
            continue
        out[k] = _filter_oneof_lists_allow(v, keep_types=keep_types)
    return out


def _apply_oneof_filter_to_subtree(
    schema_obj: Json,
    *,
    path: Optional[list[str]],
    schemas: Optional[dict[str, Any]] = None,
    keep_types: Optional[set[str]] = None,
    remove_types: Optional[set[str]] = None,
) -> Json:
    if path is None:
        if keep_types is not None:
            return _filter_oneof_lists_allow(schema_obj, keep_types=keep_types)
        if remove_types is not None:
            return _filter_oneof_lists(schema_obj, remove_types=remove_types)
        return schema_obj

    if not isinstance(schema_obj, dict):
        return schema_obj

    props = schema_obj.get("properties")
    if not isinstance(props, dict):
        return schema_obj

    head = path[0]
    child = props.get(head)
    if child is None:
        return schema_obj

    if isinstance(child, dict) and isinstance(child.get("$ref"), str) and schemas is not None:
        ref_value = child.get("$ref")
        path_part, frag = _split_ref(ref_value)
        if path_part == "" and frag.startswith("/components/schemas/"):
            toks = _decode_pointer_path(frag)
            if len(toks) >= 3 and toks[0] == "components" and toks[1] == "schemas":
                target_name = toks[2]
                target_schema = schemas.get(target_name)
                if isinstance(target_schema, dict):
                    if len(path) == 1:
                        if keep_types is not None:
                            schemas[target_name] = _filter_oneof_lists_allow(target_schema, keep_types=keep_types)
                        elif remove_types is not None:
                            schemas[target_name] = _filter_oneof_lists(target_schema, remove_types=remove_types)
                        return schema_obj

                    schemas[target_name] = _apply_oneof_filter_to_subtree(
                        target_schema,
                        path=path[1:],
                        schemas=schemas,
                        keep_types=keep_types,
                        remove_types=remove_types,
                    )
                    return schema_obj

    if len(path) == 1:
        if keep_types is not None:
            props[head] = _filter_oneof_lists_allow(child, keep_types=keep_types)
        elif remove_types is not None:
            props[head] = _filter_oneof_lists(child, remove_types=remove_types)
        return schema_obj

    if isinstance(child, dict):
        props[head] = _apply_oneof_filter_to_subtree(
            child,
            path=path[1:],
            schemas=schemas,
            keep_types=keep_types,
            remove_types=remove_types,
        )
    return schema_obj


def _filter_enum_list(values: list[Any], *, allow_values: Optional[list[str]], deny_values: Optional[list[str]]) -> list[Any]:
    out: list[Any] = list(values)
    if allow_values is not None:
        allow_set = set(allow_values)
        out = [v for v in out if v in allow_set]
    if deny_values is not None:
        deny_set = set(deny_values)
        out = [v for v in out if v not in deny_set]
    return out


def _apply_enum_filter_to_subtree(
    schema_obj: Json,
    *,
    path: Optional[list[str]],
    schemas: Optional[dict[str, Any]] = None,
    allow_values: Optional[list[str]] = None,
    deny_values: Optional[list[str]] = None,
) -> Json:
    if not isinstance(schema_obj, dict):
        return schema_obj

    if path is None:
        enum_values = schema_obj.get("enum")
        if isinstance(enum_values, list):
            schema_obj["enum"] = _filter_enum_list(
                enum_values, allow_values=allow_values, deny_values=deny_values
            )
        return schema_obj

    props = schema_obj.get("properties")
    if not isinstance(props, dict):
        return schema_obj

    head = path[0]
    child = props.get(head)
    if child is None:
        return schema_obj

    if isinstance(child, dict) and isinstance(child.get("$ref"), str) and schemas is not None:
        ref_value = child.get("$ref")
        path_part, frag = _split_ref(ref_value)
        if path_part == "" and frag.startswith("/components/schemas/"):
            toks = _decode_pointer_path(frag)
            if len(toks) >= 3 and toks[0] == "components" and toks[1] == "schemas":
                target_name = toks[2]
                target_schema = schemas.get(target_name)
                if isinstance(target_schema, dict):
                    if len(path) == 1:
                        schemas[target_name] = _apply_enum_filter_to_subtree(
                            target_schema,
                            path=None,
                            schemas=schemas,
                            allow_values=allow_values,
                            deny_values=deny_values,
                        )
                        return schema_obj

                    schemas[target_name] = _apply_enum_filter_to_subtree(
                        target_schema,
                        path=path[1:],
                        schemas=schemas,
                        allow_values=allow_values,
                        deny_values=deny_values,
                    )
                    return schema_obj

    if len(path) == 1:
        if isinstance(child, dict):
            enum_values = child.get("enum")
            if isinstance(enum_values, list):
                child["enum"] = _filter_enum_list(
                    enum_values, allow_values=allow_values, deny_values=deny_values
                )
        return schema_obj

    if isinstance(child, dict):
        props[head] = _apply_enum_filter_to_subtree(
            child,
            path=path[1:],
            schemas=schemas,
            allow_values=allow_values,
            deny_values=deny_values,
        )
    return schema_obj


def _apply_description_override_to_subtree(
    schema_obj: Json,
    *,
    path: Optional[list[str]],
    schemas: Optional[dict[str, Any]] = None,
    description: Optional[str],
) -> Json:
    if not isinstance(schema_obj, dict):
        return schema_obj

    if path is None:
        if description is None:
            schema_obj.pop("description", None)
        else:
            schema_obj["description"] = description
        return schema_obj

    props = schema_obj.get("properties")
    if not isinstance(props, dict):
        return schema_obj

    head = path[0]
    child = props.get(head)
    if child is None:
        return schema_obj

    if isinstance(child, dict) and isinstance(child.get("$ref"), str) and schemas is not None:
        ref_value = child.get("$ref")
        path_part, frag = _split_ref(ref_value)
        if path_part == "" and frag.startswith("/components/schemas/"):
            toks = _decode_pointer_path(frag)
            if len(toks) >= 3 and toks[0] == "components" and toks[1] == "schemas":
                target_name = toks[2]
                target_schema = schemas.get(target_name)
                if isinstance(target_schema, dict):
                    if len(path) == 1:
                        schemas[target_name] = _apply_description_override_to_subtree(
                            target_schema,
                            path=None,
                            schemas=schemas,
                            description=description,
                        )
                        return schema_obj

                    schemas[target_name] = _apply_description_override_to_subtree(
                        target_schema,
                        path=path[1:],
                        schemas=schemas,
                        description=description,
                    )
                    return schema_obj

    if len(path) == 1:
        if isinstance(child, dict):
            if description is None:
                child.pop("description", None)
            else:
                child["description"] = description
        return schema_obj

    if isinstance(child, dict):
        props[head] = _apply_description_override_to_subtree(
            child,
            path=path[1:],
            schemas=schemas,
            description=description,
        )
    return schema_obj


def _resolve_schema_ref(ref_value: str, schemas: Optional[dict[str, Any]]) -> Optional[Json]:
    if schemas is None:
        return None
    path_part, frag = _split_ref(ref_value)
    if path_part != "" or not frag.startswith("/components/schemas/"):
        return None
    toks = _decode_pointer_path(frag)
    if len(toks) >= 3 and toks[0] == "components" and toks[1] == "schemas":
        return schemas.get(toks[2])
    return None


def _apply_oneof_filter_to_operation_paths(
    doc: Json,
    *,
    schemas: Optional[dict[str, Any]],
    rules: list[tuple[str, str, list[str], set[str]]],
    keep: bool,
) -> None:
    if not isinstance(doc, dict):
        return
    paths_obj = doc.get("paths")
    if not isinstance(paths_obj, dict):
        return

    for method, path, segments, targets in rules:
        path_item = paths_obj.get(path)
        if not isinstance(path_item, dict):
            continue
        op_obj = path_item.get(method)
        if not isinstance(op_obj, dict):
            continue

        node: Any = op_obj
        parent: Optional[dict[str, Any]] = None
        parent_key: Optional[str] = None

        for seg in segments:
            if isinstance(node, dict) and isinstance(node.get("$ref"), str):
                resolved = _resolve_schema_ref(node["$ref"], schemas)
                if isinstance(resolved, dict):
                    node = resolved
            if not isinstance(node, dict) or seg not in node:
                parent = None
                break
            parent = node
            parent_key = seg
            node = node[seg]

        if parent is None or parent_key is None:
            continue

        if isinstance(node, dict) and isinstance(node.get("$ref"), str):
            resolved = _resolve_schema_ref(node["$ref"], schemas)
            if isinstance(resolved, dict):
                node = resolved

        if keep:
            parent[parent_key] = _filter_oneof_lists_allow(node, keep_types=targets)
        else:
            parent[parent_key] = _filter_oneof_lists(node, remove_types=targets)


def _build_allow_field_tree(paths: list[list[str]]) -> dict[str, Any]:
    tree: dict[str, Any] = {}
    for segs in paths:
        cur = tree
        for i, s in enumerate(segs):
            if s not in cur:
                cur[s] = {}
            if i == len(segs) - 1:
                cur[s] = True
                break
            if cur[s] is True:
                break
            cur = cur[s]
    return tree


def _apply_allow_fields(schema: Json, allow_paths: list[list[str]]) -> None:
    if not allow_paths:
        return

    tree = _build_allow_field_tree(allow_paths)

    def _prune(node: Json, *, allow_tree: dict[str, Any]) -> None:
        if not isinstance(node, dict):
            return

        for key in ("allOf", "anyOf", "oneOf"):
            v = node.get(key)
            if isinstance(v, list):
                for item in v:
                    _prune(item, allow_tree=allow_tree)

        props = node.get("properties")
        if not isinstance(props, dict):
            return

        new_props: dict[str, Any] = {}
        for prop_name, allow_spec in allow_tree.items():
            if prop_name not in props:
                continue
            if allow_spec is True:
                new_props[prop_name] = props[prop_name]
            else:
                new_props[prop_name] = props[prop_name]
                _prune(new_props[prop_name], allow_tree=allow_spec)

        node["properties"] = new_props
        req = node.get("required")
        if isinstance(req, list):
            node["required"] = [x for x in req if x in new_props]

    _prune(schema, allow_tree=tree)

def _remove_property_path(schema: Json, segments: list[str]) -> None:
    """
    Best-effort removal of a nested property path from a schema object.

    We only understand object schemas with "properties", and we will also walk
    combinators (allOf/anyOf/oneOf) to catch common patterns.
    """
    if not segments:
        return
    if isinstance(schema, dict):
        # Apply to combinators first (fields often get introduced via allOf).
        for key in ("allOf", "anyOf", "oneOf"):
            v = schema.get(key)
            if isinstance(v, list):
                for item in v:
                    _remove_property_path(item, segments)

        props = schema.get("properties")
        if not isinstance(props, dict):
            return

        head = segments[0]
        if len(segments) == 1:
            if head in props:
                del props[head]
            req = schema.get("required")
            if isinstance(req, list):
                schema["required"] = [x for x in req if x != head]
            return

        child = props.get(head)
        _remove_property_path(child, segments[1:])


def _decode_pointer_path(pointer: str) -> list[str]:
    if pointer in ("", None):
        return []
    if not pointer.startswith("/"):
        return []
    return [_decode_json_pointer_token(t) for t in pointer.lstrip("/").split("/") if t != ""]


def _expand_bracket_indexes(token: str, *, context: str) -> list[str]:
    # Allow tokens like "oneOf[1]" or "items[0][2]" as a shorthand.
    if "[" not in token:
        return [token]
    match = re.match(r"^([^\[]+)((\[\d+\])+)$$", token)
    if not match:
        raise RuntimeError(f"Invalid bracket index token {token!r} in {context}.")
    name = match.group(1)
    if not name:
        raise RuntimeError(f"Invalid bracket index token {token!r} in {context}.")
    indexes = re.findall(r"\[(\d+)\]", match.group(2))
    return [name, *indexes]


def _resolve_pointer_with_refs(
    node: Json,
    pointer: str,
    *,
    schemas: Optional[dict[str, Any]],
    context: str,
) -> Json:
    if pointer in ("", None):
        return node
    if not pointer.startswith("/"):
        raise RuntimeError(f"Invalid JSON pointer {pointer!r} for {context} (expected '' or '/...').")

    cur: Json = node
    for raw_token in pointer.lstrip("/").split("/"):
        token = _decode_json_pointer_token(raw_token)
        for expanded in _expand_bracket_indexes(token, context=context):
            if isinstance(cur, dict) and isinstance(cur.get("$ref"), str):
                ref_value = cur.get("$ref")
                resolved = _resolve_schema_ref(ref_value, schemas)
                if resolved is not None:
                    cur = resolved
            if isinstance(cur, dict):
                if expanded not in cur:
                    raise RuntimeError(f"Pointer token {expanded!r} not found while resolving {context}.")
                cur = cur[expanded]
            elif isinstance(cur, list):
                try:
                    idx = int(expanded)
                except ValueError as e:
                    raise RuntimeError(
                        f"Pointer token {expanded!r} is not a list index while resolving {context}."
                    ) from e
                try:
                    cur = cur[idx]
                except IndexError as e:
                    raise RuntimeError(f"List index {idx} out of range while resolving {context}.") from e
            else:
                raise RuntimeError(f"Cannot dereference through non-container while resolving {context}.")
    return cur


def _strip_refs_to_denied_types(
    node: Json,
    *,
    deny_types: set[str],
    allow_types: Optional[set[str]] = None,
) -> Json:
    """
    Replace internal $refs to denied component schemas with `{}` (any schema).

    This keeps the output spec structurally usable while ensuring those types
    won't be rendered as full definitions.
    """
    if isinstance(node, list):
        return [_strip_refs_to_denied_types(v, deny_types=deny_types) for v in node]
    if not isinstance(node, dict):
        return node

    if "$ref" in node and isinstance(node.get("$ref"), str):
        ref_value = node["$ref"]
        path_part, frag = _split_ref(ref_value)
        if path_part == "" and frag.startswith("/components/schemas/"):
            toks = _decode_pointer_path(frag)
            # tokens: ["components","schemas","TypeName", ...]
            if len(toks) >= 3 and toks[0] == "components" and toks[1] == "schemas":
                tname = toks[2]
                if (allow_types is not None and tname not in allow_types) or tname in deny_types:
                    siblings = {k: v for k, v in node.items() if k != "$ref"}
                    if siblings:
                        # Keep any non-ref constraints, just drop the ref itself.
                        return _strip_refs_to_denied_types(
                            siblings, deny_types=deny_types, allow_types=allow_types
                        )
                    return {}

    out: dict[str, Any] = {}
    for k, v in node.items():
        out[k] = _strip_refs_to_denied_types(v, deny_types=deny_types, allow_types=allow_types)
    return out


_SCHEMA_LIST_KEYS: set[str] = {
    # JSON Schema combinators
    "oneOf",
    "anyOf",
    "allOf",
    # JSON Schema 2020-12 tuple typing keyword (OpenAPI 3.1 uses JSON Schema vocab)
    "prefixItems",
}


def _prune_empty_schema_objects(node: Json, *, parent_key: Optional[str] = None) -> Json:
    """
    Remove `{}` elements introduced by filtering from schema lists like oneOf/anyOf/allOf.

    We intentionally scope this to known schema-list keywords to avoid removing
    meaningful empty objects elsewhere (e.g. examples payloads).
    """
    if isinstance(node, list):
        pruned = [_prune_empty_schema_objects(v, parent_key=parent_key) for v in node]
        if parent_key in _SCHEMA_LIST_KEYS:
            pruned = [v for v in pruned if not (isinstance(v, dict) and len(v) == 0)]
        return pruned

    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            out[k] = _prune_empty_schema_objects(v, parent_key=str(k) if isinstance(k, str) else None)

        # If we pruned everything out of a schema list, drop the keyword entirely.
        for key in _SCHEMA_LIST_KEYS:
            v = out.get(key)
            if isinstance(v, list) and len(v) == 0:
                del out[key]
        return out

    return node


def _is_empty_array_schema(node: Json) -> bool:
    if not isinstance(node, dict):
        return False
    type_value = node.get("type")
    is_array = type_value == "array" or (isinstance(type_value, list) and "array" in type_value) or "items" in node
    if not is_array:
        return False
    items = node.get("items")
    return isinstance(items, dict) and len(items) == 0


def _prune_empty_array_items(node: Json, *, parent_key: Optional[str] = None) -> Json:
    """
    Drop array schemas with empty `items` from schema lists and object properties.
    """
    if isinstance(node, list):
        pruned = [_prune_empty_array_items(v, parent_key=parent_key) for v in node]
        if parent_key in _SCHEMA_LIST_KEYS:
            pruned = [v for v in pruned if not _is_empty_array_schema(v)]
        return pruned

    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            out[k] = _prune_empty_array_items(v, parent_key=str(k) if isinstance(k, str) else None)

        props = out.get("properties")
        if isinstance(props, dict):
            for prop_name in list(props.keys()):
                if _is_empty_array_schema(props[prop_name]):
                    del props[prop_name]
                    req = out.get("required")
                    if isinstance(req, list):
                        out["required"] = [x for x in req if x != prop_name]
        return out

    return node


def _flatten_nested_schema_lists(node: Json, *, parent_key: Optional[str] = None) -> Json:
    """
    Flatten nested oneOf/anyOf/allOf lists to reduce nesting noise from generators.
    """
    if isinstance(node, list):
        flattened = [_flatten_nested_schema_lists(v, parent_key=parent_key) for v in node]
        if parent_key in _SCHEMA_LIST_KEYS:
            out: list[Json] = []
            for item in flattened:
                if (
                    isinstance(item, dict)
                    and isinstance(item.get(parent_key), list)
                    and set(item.keys()) == {parent_key}
                ):
                    nested_list = item.get(parent_key)
                    if isinstance(nested_list, list):
                        out.extend(nested_list)
                        continue
                out.append(item)
            return out
        return flattened

    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            out[k] = _flatten_nested_schema_lists(v, parent_key=str(k) if isinstance(k, str) else None)

        for key in _SCHEMA_LIST_KEYS:
            v = out.get(key)
            if isinstance(v, list):
                flattened: list[Json] = []
                for item in v:
                    if (
                        isinstance(item, dict)
                        and isinstance(item.get(key), list)
                        and set(item.keys()) == {key}
                    ):
                        nested_list = item.get(key)
                        if isinstance(nested_list, list):
                            flattened.extend(nested_list)
                            continue
                    flattened.append(item)
                out[key] = flattened
        return out

    return node


def _collect_schema_refs(
    node: Json,
    *,
    refs: set[str],
    skip_schema_definitions: bool,
    in_schema_def: bool = False,
    parent_key: Optional[str] = None,
) -> None:
    if in_schema_def and skip_schema_definitions:
        return

    if isinstance(node, dict):
        ref_value = node.get("$ref")
        if isinstance(ref_value, str):
            path_part, frag = _split_ref(ref_value)
            if path_part == "" and frag.startswith("/components/schemas/"):
                toks = _decode_pointer_path(frag)
                if len(toks) >= 3 and toks[0] == "components" and toks[1] == "schemas":
                    refs.add(toks[2])

        for k, v in node.items():
            next_in_schema_def = in_schema_def or (parent_key == "components" and k == "schemas")
            _collect_schema_refs(
                v,
                refs=refs,
                skip_schema_definitions=skip_schema_definitions,
                in_schema_def=next_in_schema_def,
                parent_key=k if isinstance(k, str) else None,
            )
        return

    if isinstance(node, list):
        for v in node:
            _collect_schema_refs(
                v,
                refs=refs,
                skip_schema_definitions=skip_schema_definitions,
                in_schema_def=in_schema_def,
                parent_key=parent_key,
            )
        return


def _prune_unused_schemas(doc: Json) -> Json:
    if not isinstance(doc, dict):
        return doc
    components = doc.get("components")
    if not isinstance(components, dict):
        return doc
    schemas = components.get("schemas")
    if not isinstance(schemas, dict):
        return doc

    initial_refs: set[str] = set()
    _collect_schema_refs(doc, refs=initial_refs, skip_schema_definitions=True)

    reachable: set[str] = set()
    stack = list(initial_refs)
    while stack:
        name = stack.pop()
        if name in reachable:
            continue
        schema_obj = schemas.get(name)
        if not isinstance(schema_obj, dict):
            continue
        reachable.add(name)
        inner_refs: set[str] = set()
        _collect_schema_refs(schema_obj, refs=inner_refs, skip_schema_definitions=False)
        for ref_name in inner_refs:
            if ref_name not in reachable:
                stack.append(ref_name)

    for name in list(schemas.keys()):
        if name not in reachable:
            del schemas[name]

    return doc


def _apply_manifest_filters(doc: Json, *, manifest_path: Path) -> Json:
    """
    Apply deny rules to a bundled/inlined OpenAPI document.

    Supported rules:
      - deny.types: remove `components.schemas[TypeName]` definitions
      - deny.fields: remove object properties (dot-paths) from a given type definition
    """
    manifest = _load_manifest(manifest_path)
    allow_types, deny_types = _get_manifest_types(manifest)
    allow_fields, deny_fields = _get_manifest_fields(manifest)
    allow_oneof, deny_oneof, allow_oneof_paths, deny_oneof_paths = _get_manifest_oneof(manifest)
    allow_enums, deny_enums = _get_manifest_enums(manifest)
    allow_desc, deny_desc = _get_manifest_descriptions(manifest)

    if (
        not allow_types
        and not deny_types
        and not allow_fields
        and not deny_fields
        and not allow_oneof
        and not deny_oneof
        and not allow_oneof_paths
        and not deny_oneof_paths
        and not allow_enums
        and not deny_enums
        and not allow_desc
        and not deny_desc
    ):
        return doc

    removed_types = set(deny_types)

    if not isinstance(doc, dict):
        return doc

    # Normalize nested schema lists early so allow/deny oneOf matches work as expected.
    doc = _flatten_nested_schema_lists(doc)

    components = doc.get("components")
    if isinstance(components, dict):
        schemas = components.get("schemas")
        if isinstance(schemas, dict):
            if allow_types:
                for tname in list(schemas.keys()):
                    if tname not in allow_types:
                        removed_types.add(tname)

            # Remove types entirely.
            for tname in sorted(removed_types):
                if tname in schemas:
                    del schemas[tname]

            # Apply allowlist field pruning first, then denylist removals.
            for tname, paths in allow_fields.items():
                schema_obj = schemas.get(tname)
                if not isinstance(schema_obj, dict):
                    continue
                _apply_allow_fields(schema_obj, paths)

            for tname, paths in deny_fields.items():
                schema_obj = schemas.get(tname)
                if not isinstance(schema_obj, dict):
                    continue
                for segs in paths:
                    _remove_property_path(schema_obj, segs)

            # Apply enum allow/deny filters.
            for owner, rules in allow_enums.items():
                schema_obj = schemas.get(owner)
                if not isinstance(schema_obj, dict):
                    continue
                for path, values in rules:
                    schema_obj = _apply_enum_filter_to_subtree(
                        schema_obj, path=path, schemas=schemas, allow_values=values
                    )
                schemas[owner] = schema_obj

            for owner, rules in deny_enums.items():
                schema_obj = schemas.get(owner)
                if not isinstance(schema_obj, dict):
                    continue
                for path, values in rules:
                    schema_obj = _apply_enum_filter_to_subtree(
                        schema_obj, path=path, schemas=schemas, deny_values=values
                    )
                schemas[owner] = schema_obj

            # Apply description overrides (allow = set, deny = remove).
            for owner, rules in allow_desc.items():
                schema_obj = schemas.get(owner)
                if not isinstance(schema_obj, dict):
                    continue
                for path, desc in rules:
                    schema_obj = _apply_description_override_to_subtree(
                        schema_obj, path=path, schemas=schemas, description=desc
                    )
                schemas[owner] = schema_obj

            for owner, rules in deny_desc.items():
                schema_obj = schemas.get(owner)
                if not isinstance(schema_obj, dict):
                    continue
                for path, desc in rules:
                    schema_obj = _apply_description_override_to_subtree(
                        schema_obj, path=path, schemas=schemas, description=None if desc is None else desc
                    )
                schemas[owner] = schema_obj

            # Apply oneOf allowlists first, then denylists.
            for owner, rules in allow_oneof.items():
                schema_obj = schemas.get(owner)
                if not isinstance(schema_obj, dict):
                    continue
                for path, targets in rules:
                    schema_obj = _apply_oneof_filter_to_subtree(
                        schema_obj, path=path, schemas=schemas, keep_types=targets
                    )
                schemas[owner] = schema_obj

            for owner, rules in deny_oneof.items():
                schema_obj = schemas.get(owner)
                if not isinstance(schema_obj, dict):
                    continue
                for path, targets in rules:
                    schema_obj = _apply_oneof_filter_to_subtree(
                        schema_obj, path=path, schemas=schemas, remove_types=targets
                    )
                schemas[owner] = schema_obj

            # Apply path-based oneOf filters (operation response schemas, etc).
            _apply_oneof_filter_to_operation_paths(
                doc, schemas=schemas, rules=allow_oneof_paths, keep=True
            )
            _apply_oneof_filter_to_operation_paths(
                doc, schemas=schemas, rules=deny_oneof_paths, keep=False
            )

    # Best-effort: scrub any internal $refs that would now point at missing definitions
    # then prune `{}` branches introduced by the scrub in schema combinators.
    doc = _strip_refs_to_denied_types(doc, deny_types=removed_types, allow_types=allow_types or None)
    doc = _flatten_nested_schema_lists(doc)
    doc = _prune_empty_schema_objects(doc)
    doc = _prune_empty_array_items(doc)
    return _prune_unused_schemas(doc)


def _apply_additive_patches(doc: Json, *, patches_path: Path) -> Json:
    patches = _load_additive_patches(patches_path)
    add_root = patches.get("add", {})
    if add_root is None:
        return doc
    if not isinstance(add_root, dict):
        raise RuntimeError("Patches add must be an object if provided.")

    if not isinstance(doc, dict):
        return doc

    components = doc.get("components")
    if components is None:
        components = {}
        doc["components"] = components
    if not isinstance(components, dict):
        raise RuntimeError("Top-level 'components' exists but is not an object; cannot apply patches.")

    schemas = components.get("schemas")
    if schemas is None:
        schemas = {}
        components["schemas"] = schemas
    if not isinstance(schemas, dict):
        raise RuntimeError("components.schemas exists but is not an object; cannot apply patches.")

    add_schemas = add_root.get("schemas", {})
    if add_schemas is None:
        add_schemas = {}
    if not isinstance(add_schemas, dict):
        raise RuntimeError("Patches add.schemas must be an object mapping schema name -> schema object.")
    for name, schema_obj in add_schemas.items():
        if not isinstance(name, str):
            raise RuntimeError("Patches add.schemas keys must be strings.")
        if not isinstance(schema_obj, dict):
            raise RuntimeError(f"Patches add.schemas.{name} must be an object.")
        if name in schemas and schemas[name] != schema_obj:
            raise RuntimeError(f"Patch schema {name!r} conflicts with existing definition.")
        schemas[name] = schema_obj

    list_rules = add_root.get("schema_lists", [])
    if list_rules is None:
        list_rules = []
    if not isinstance(list_rules, list):
        raise RuntimeError("Patches add.schema_lists must be a list.")
    for idx, rule in enumerate(list_rules):
        if not isinstance(rule, dict):
            raise RuntimeError("Each schema_lists entry must be an object.")
        schema_name = rule.get("schema")
        pointer = rule.get("path", "")
        refs = rule.get("refs", [])
        if not isinstance(schema_name, str) or not schema_name:
            raise RuntimeError("schema_lists entries must include non-empty 'schema' string.")
        if not isinstance(pointer, str):
            raise RuntimeError("schema_lists 'path' must be a string if provided.")
        if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
            raise RuntimeError("schema_lists 'refs' must be a list of strings.")
        schema_obj = schemas.get(schema_name)
        if not isinstance(schema_obj, dict):
            raise RuntimeError(f"schema_lists schema {schema_name!r} not found in components.schemas.")
        target = _resolve_pointer_with_refs(
            schema_obj,
            pointer,
            schemas=schemas,
            context=f"schema_lists[{idx}] ({schema_name})",
        )
        if not isinstance(target, list):
            raise RuntimeError("schema_lists target must resolve to a list.")
        items = target

        existing_refs = set()
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("$ref"), str):
                existing_refs.add(item["$ref"])
        for ref_name in refs:
            internal_ref = f"#/components/schemas/{ref_name}"
            if internal_ref in existing_refs:
                continue
            if ref_name not in schemas:
                raise RuntimeError(
                    f"schema_lists ref {ref_name!r} not found in components.schemas (add it in add.schemas)."
                )
            items.append({"$ref": internal_ref})
            existing_refs.add(internal_ref)

    enum_rules = add_root.get("enums", [])
    if enum_rules is None:
        enum_rules = []
    if not isinstance(enum_rules, list):
        raise RuntimeError("Patches add.enums must be a list.")
    for idx, rule in enumerate(enum_rules):
        if not isinstance(rule, dict):
            raise RuntimeError("Each enums entry must be an object.")
        schema_name = rule.get("schema")
        pointer = rule.get("path", "")
        values = rule.get("values", [])
        if not isinstance(schema_name, str) or not schema_name:
            raise RuntimeError("enums entries must include non-empty 'schema' string.")
        if not isinstance(pointer, str):
            raise RuntimeError("enums 'path' must be a string if provided.")
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            raise RuntimeError("enums 'values' must be a list of strings.")
        schema_obj = schemas.get(schema_name)
        if not isinstance(schema_obj, dict):
            raise RuntimeError(f"enums schema {schema_name!r} not found in components.schemas.")
        target = _resolve_pointer_with_refs(
            schema_obj,
            pointer,
            schemas=schemas,
            context=f"enums[{idx}] ({schema_name})",
        )
        if not isinstance(target, dict):
            raise RuntimeError("enums target must resolve to an object.")
        enum_list = target.get("enum")
        if enum_list is None:
            enum_list = []
            target["enum"] = enum_list
        if not isinstance(enum_list, list):
            raise RuntimeError("enums target enum must be a list.")
        for v in values:
            if v not in enum_list:
                enum_list.append(v)

    field_rules = add_root.get("schema_fields", [])
    if field_rules is None:
        field_rules = []
    if not isinstance(field_rules, list):
        raise RuntimeError("Patches add.schema_fields must be a list.")
    for idx, rule in enumerate(field_rules):
        if not isinstance(rule, dict):
            raise RuntimeError("Each schema_fields entry must be an object.")
        schema_name = rule.get("schema")
        pointer = rule.get("path", "")
        merge_obj = rule.get("merge", {})
        if not isinstance(schema_name, str) or not schema_name:
            raise RuntimeError("schema_fields entries must include non-empty 'schema' string.")
        if not isinstance(pointer, str):
            raise RuntimeError("schema_fields 'path' must be a string if provided.")
        if not isinstance(merge_obj, dict):
            raise RuntimeError("schema_fields 'merge' must be an object.")
        schema_obj = schemas.get(schema_name)
        if not isinstance(schema_obj, dict):
            raise RuntimeError(f"schema_fields schema {schema_name!r} not found in components.schemas.")
        target = _resolve_pointer_with_refs(
            schema_obj,
            pointer,
            schemas=schemas,
            context=f"schema_fields[{idx}] ({schema_name})",
        )
        if not isinstance(target, dict):
            raise RuntimeError("schema_fields target must resolve to an object.")
        merged = _deep_merge(target, merge_obj)
        if not isinstance(merged, dict):
            raise RuntimeError("schema_fields merge must result in an object.")
        target.clear()
        target.update(merged)

    return doc


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    entrypoint_raw = args.entrypoint or args.entrypoint_pos
    if not entrypoint_raw:
        _eprint("error: missing entrypoint (provide a positional entrypoint or --entrypoint).")
        return 2

    entrypoint = Path(entrypoint_raw)
    if not entrypoint.exists():
        _eprint(f"error: entrypoint does not exist: {entrypoint}")
        return 2

    try:
        if args.endpoint:
            entry_abs = entrypoint.resolve()
            if args.mode == "inline":
                inliner = RefInliner(
                    inline_internal_refs=bool(args.inline_internal_refs),
                    on_cycle=str(args.on_cycle),
                    max_depth=int(args.max_depth),
                )
                entry_doc = inliner._load_cached(entry_abs)
                out_doc = _selective_megaspec(
                    deepcopy(entry_doc),
                    entry_file=entry_abs,
                    inliner=inliner,
                    endpoints=list(args.endpoint),
                )
            else:
                bundler = RefBundler(
                    inline_internal_refs=bool(args.inline_internal_refs),
                    on_cycle=str(args.on_cycle),
                    max_depth=int(args.max_depth),
                )
                entry_doc = bundler._load_cached(entry_abs)
                out_doc = _selective_megaspec_bundle(
                    deepcopy(entry_doc),
                    entry_file=entry_abs,
                    bundler=bundler,
                    endpoints=list(args.endpoint),
                )
        else:
            if args.mode == "inline":
                inliner = RefInliner(
                    inline_internal_refs=bool(args.inline_internal_refs),
                    on_cycle=str(args.on_cycle),
                    max_depth=int(args.max_depth),
                )
                out_doc = inliner.inline(entrypoint)
            else:
                bundler = RefBundler(
                    inline_internal_refs=bool(args.inline_internal_refs),
                    on_cycle=str(args.on_cycle),
                    max_depth=int(args.max_depth),
                )
                out_doc = bundler.bundle(entrypoint)
        out_doc = _strip_x_properties(
            out_doc,
            keep_keys={"x-inlineable", "x-enumDescriptions", "x-unionDisplay", "x-unionTitle"},
        )
        if args.manifest:
            out_doc = _apply_manifest_filters(out_doc, manifest_path=Path(args.manifest))
        if args.patches:
            out_doc = _apply_additive_patches(out_doc, patches_path=Path(args.patches))
    except Exception as e:
        _eprint(f"error: {e}")
        return 1

    indent = None if args.no_pretty else 2
    content = json.dumps(out_doc, indent=indent, ensure_ascii=True, sort_keys=False) + ("\n" if indent else "")

    if args.output:
        Path(args.output).write_text(content, encoding="utf-8")
    else:
        sys.stdout.write(content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
