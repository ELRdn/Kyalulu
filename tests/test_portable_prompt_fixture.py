import json
from pathlib import Path
import pytest
from python.core.portable_prompt import compile_portable, assemble_messages

CASES=json.loads((Path(__file__).parent/'fixtures/portable-prompt.json').read_text(encoding='utf-8'))

@pytest.mark.parametrize('case',CASES,ids=[case['name'] for case in CASES])
def test_portable_prompt_shared_fixture(case):
    compiled=compile_portable(case['snapshot'],case['history'])
    assert compiled.model_dump()==case['expected']
    assert assemble_messages(compiled,case['history'],'FORMAT CONTRACT')==case['assembled']
