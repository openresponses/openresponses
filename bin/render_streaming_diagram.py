#!/usr/bin/env python3
"""Render a compact railroad diagram for streaming event transitions.

The adjacency map is encoded in ``event_tree`` below. The script collapses
shared sub-paths and self-loops so the resulting SVG remains readable.

Usage:
    python bin/render_streaming_diagram.py > diagram.svg

Pass ``--output`` to write the SVG to a specific file. Self-referential edges
and strongly connected cycles are rendered as repeatable segments.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Iterable
from itertools import chain
from typing import Dict, List, Sequence

from pyrailroad.elements import (
    Choice,
    Diagram,
    OneOrMore,
    Sequence as RRSequence,
    Terminal,
)

Graph = Dict[str, List[str]]


event_tree: Graph = {
    "response.created": [
        "response.in_progress",
    ],
    "response.in_progress": ["response.output_item.added", "error"],
    "response.output_item.added": [
        "response.content_part.added",
        "response.output_item.done",
    ],
    "response.content_part.added": [
        "response.output_text.delta",
        "response.content_part.done",
    ],
    "response.output_text.delta": [
        "response.output_text.delta",
        "response.output_text.done",
    ],
    "response.output_text.done": ["response.content_part.done"],
    "response.content_part.done": [
        "response.content_part.added",
        "response.output_item.done",
    ],
    "response.output_item.done": [
        "response.output_item.added",
        "response.completed",
        "response.incomplete",
    ],
    "response.incomplete": [],
    "response.completed": [],
    "error": ["response.failed"],
    "response.failed": [],
}

simple_event_tree: Graph = {
    "response.output_item.added": [
        "response.content_part.added",
        "response.output_item.done",
    ],
    "response.content_part.added": [
        "response.[content-part-type].delta",
        "response.content_part.done",
    ],
    "response.[content-part-type].delta": [
        "response.[content-part-type].delta",
        "response.[content-part-type].done",
    ],
    "response.[content-part-type].done": [
        "response.content_part.added",
        "response.output_item.done"
    ]
}

def normalize_graph(raw: Graph) -> Graph:
    """Normalize the adjacency map and deduplicate successor lists."""
    normalized: Graph = {}
    for raw_key, raw_values in raw.items():
        key = str(raw_key)
        if raw_values is None:
            normalized[key] = []
            continue
        if isinstance(raw_values, str):
            normalized[key] = [raw_values]
            continue
        if isinstance(raw_values, Iterable):
            if isinstance(raw_values, dict):
                raise SystemExit(
                    f"Invalid successor list for '{key}': expected list or string."
                )
            deduped: List[str] = []
            for value in raw_values:
                text = str(value)
                if text not in deduped:
                    deduped.append(text)
            normalized[key] = deduped
            continue
        raise SystemExit(
            f"Invalid successor list for '{key}': expected list or string."
        )

    # Ensure every referenced successor exists in the map.
    referenced: Set[str] = set(chain.from_iterable(normalized.values()))
    for missing in referenced:
        normalized.setdefault(missing, [])

    return normalized


def find_start_events(graph: Graph) -> List[str]:
    """Return events with no incoming edges (or all events as fallback)."""
    successors = set(chain.from_iterable(graph.values()))
    candidates = [event for event in graph if event not in successors]
    return candidates or sorted(graph.keys())


def build_node_diagram(
    node: str,
    graph: Graph,
    stack: Sequence[str],
    cache: Dict[str, object],
) -> object:
    """Render a node and its successors while avoiding infinite recursion."""
    if node in cache:
        return cache[node]

    successors = graph.get(node, [])
    self_loop = node in successors
    non_self_successors = [succ for succ in successors if succ != node]

    base: object = Terminal(node)
    if self_loop:
        base = OneOrMore(base)

    if not non_self_successors:
        cache[node] = base
        return base

    tail_items: List[object] = []
    for successor in non_self_successors:
        if successor in stack:
            tail_items.append(Terminal(f"{successor} ↺"))
        else:
            tail_items.append(
                build_node_diagram(successor, graph, (*stack, node), cache)
            )

    tail = tail_items[0] if len(tail_items) == 1 else Choice(0, *tail_items)
    result = RRSequence(base, tail)
    cache[node] = result
    return result


def build_diagram(graph: Graph, starts: Sequence[str]) -> Diagram:
    """Compose the full railroad diagram from the adjacency graph."""
    cache: Dict[str, object] = {}
    branches = [
        build_node_diagram(start, graph, (), cache)
        for start in starts
    ]

    if not branches:
        raise SystemExit("No paths discovered. Check the event graph.")

    root = branches[0] if len(branches) == 1 else Choice(0, *branches)
    return Diagram(root)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render the railroad diagram for streaming event transitions.",
    )
    parser.add_argument(
        "--output",
        "-o",
        metavar="PATH",
        help="Optional file to write the SVG diagram to (defaults to stdout).",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> None:
    args = parse_args(argv)
    graph = normalize_graph(simple_event_tree)
    starts = find_start_events(graph)
    diagram = build_diagram(graph, starts)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            diagram.write_standalone(fh.write)
    else:
        diagram.write_text(sys.stdout.write)


if __name__ == "__main__":
    main(sys.argv[1:])
