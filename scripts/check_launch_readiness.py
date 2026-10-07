"""Read-only preflight. Exit 2 means release prerequisites are still missing."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))
from python.cloud.release_readiness import audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--backend", choices=("opencode-go", "openrouter", "deepseek"), default="openrouter")
    parser.add_argument("--phase", choices=("local_beta", "cloud_first_ten", "sales", "cloud_first_hundred"), default="cloud_first_ten")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--template", action="store_true")
    args = parser.parse_args()
    if args.template:
        result = {gate: {"accepted": False, "kind": "real", "source_fingerprint": "",
                         "evidence": "", "sha256": ""} for gate in audit(backend=args.backend)["gates"]}
    else:
        evidence = json.loads(args.evidence.read_text(encoding="utf-8")) if args.evidence else {}
        if not isinstance(evidence, dict):
            raise ValueError("evidence must be an object")
        result = audit(evidence, backend=args.backend)
    output = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        path = args.output.resolve()
        if not path.is_relative_to(ROOT.resolve()):
            raise ValueError("report destination must stay in workspace")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0 if args.template or result["phases"][args.phase]["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
