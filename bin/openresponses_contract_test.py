import json
from pathlib import Path

from compare_openapi import compare_documents


def test_current_contract_matches_published_release():
    directory = Path(__file__).resolve().parents[1] / "public/openapi"
    current = json.loads((directory / "openapi.json").read_text())
    released = json.loads(
        (directory / current["info"]["version"] / "openapi.json").read_text()
    )
    contract, _ = compare_documents(released, current)
    assert not contract, "\n".join(contract)
