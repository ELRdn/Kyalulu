"""Edge decoration must never hide modified published content."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from verify_docs_public import CF_JSD, reviewed_html


def test_only_known_cloudflare_decoration_is_accepted():
    expected = b'<html><body><p>Reviewed</p></body></html>\n'
    assert reviewed_html(expected, expected) is False
    decoration = CF_JSD.replace(b"'RAY'", b"'a494179acf82f4e1'").replace(b"'TIME'", b"'MTc5MTc4NzAwNw=='")
    raw = expected.replace(b'</body>', decoration + b'</body>')
    assert reviewed_html(raw, expected) is True
    for altered in (raw.replace(b'Reviewed', b'Changed'), raw.replace(b'jsd/main.js', b'evil.js'),
                    raw.replace(b'</body>', b'<script>evil()</script></body>')):
        with pytest.raises(AssertionError):
            reviewed_html(altered, expected)
