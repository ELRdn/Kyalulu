# Data

`characters.json`: 12 public, original adult fictional character cards.

`cases.jsonl`: 132 units / 264 responses per repeat, including evaluator-only fields.

[Question catalog](../docs/QUESTION_CATALOG.html) shows every prompt and evaluation note in the browser. Do not feed that researcher catalog to candidate models.

[Dataset card](../docs/DATASET_CARD.md) documents the public synthetic pilot and its limitations.

Regenerate from the package root with `python tools/build_dataset.py`. This overwrites the bundled corpus and is a development action, not a step needed to run the benchmark.
