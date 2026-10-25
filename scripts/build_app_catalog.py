"""Generate the browser's bundled SFW catalog from the existing local catalog."""
import json
from pathlib import Path
import yaml
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    result = {}
    for folder in ("characters", "personas", "worlds", "scenarios"):
        rows = []
        for path in sorted((ROOT / folder).glob("*.yaml")):
            row = yaml.safe_load(path.read_text(encoding="utf-8"))
            if isinstance(row, dict) and not row.get("nsfw"):
                rows.append(row)
        result[folder] = rows
    sys.path.insert(0, str(ROOT / 'runtime'))
    from python.core.benchmark import advanced_scenario, scenario_catalog
    result['scenarios'].extend(advanced_scenario(row['id']).model_dump() for row in scenario_catalog())
    target = ROOT / "apps/web/src/mobile/app-catalog.generated.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Pin Python casefold semantics, including expansions and non-BMP characters.
    folding = {chr(i): chr(i).casefold() for i in range(0x110000) if chr(i) != chr(i).casefold()}
    (target.parent / 'casefold.generated.json').write_text(json.dumps(folding, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == "__main__":
    main()
