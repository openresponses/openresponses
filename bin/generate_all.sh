#! /bin/bash

set -eof pipefail

which python

echo "==== Generating curl snippets ===="

python bin/generate_curl_snippets.py

echo "==== Generating object examples ===="

python bin/generate_examples.py

echo "==== Generating railroad diagram examples ===="

python bin/render_streaming_diagram.py