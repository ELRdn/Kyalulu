"""Shared strict UTF-8/JSON framing fixtures contain no application data."""
import json
from pathlib import Path

import pytest
from python.cloud.json_stream import JsonStream
from python.cloud.entity_transfers import json_chunks, CHUNK_BYTES

CASES = json.loads((Path(__file__).parent / 'fixtures/json-stream.json').read_text(encoding='utf-8'))


def parse(raw, width):
    parser = JsonStream()
    for index in range(0, len(raw), width): parser.feed(raw[index:index + width])
    return parser.finish()


def test_shared_valid_cases_match_stdlib_at_small_byte_boundaries():
    for text in CASES['valid']:
        raw = text.encode()
        for width in (1, 2, 3, 7, 64, 1024):
            assert parse(raw, width) == json.loads(raw)


def test_shared_invalid_syntax_and_utf8_never_complete():
    for text in CASES['invalid']:
        for width in (1, 2, 7, 1024):
            with pytest.raises(ValueError): parse(text.encode(), width)
    for value in CASES['invalid_utf8_hex']:
        for width in (1, 2, 7):
            with pytest.raises(ValueError): parse(bytes.fromhex(value), width)


def test_terminal_state_and_depth_limit():
    parser = JsonStream(); parser.feed(b'{}'); assert parser.finish() == {}
    with pytest.raises(ValueError): parser.feed(b'')
    with pytest.raises(ValueError): parser.finish()
    parser = JsonStream()
    with pytest.raises(ValueError): parser.feed(b'}')
    with pytest.raises(ValueError): parser.feed(b'{}')
    with pytest.raises(ValueError): parse(b'['*65+b']'*65, 7)


def test_punctuation_mutations_match_stdlib_acceptance():
    for source in CASES['valid']:
        for index, char in enumerate(source):
            if ord(char) > 127: continue
            raw = (source[:index]+','+source[index+1:]).encode()
            try: expected = json.loads(raw)
            except ValueError:
                with pytest.raises(ValueError): parse(raw, 3)
                continue
            assert parse(raw, 3) == expected


def test_large_receive_retains_decoded_values_without_an_entire_encoded_copy():
    import tracemalloc
    content = '茶🙂' * 2000
    source = {'messages': [{'content': content, 'id': index} for index in range(6000)]}
    tracemalloc.start()
    try:
        parser, size = JsonStream(), 0
        for chunk in json_chunks(source):
            size += len(chunk); parser.feed(chunk)
        result = parser.finish()
        retained, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert size > 84_000_000 and len(result['messages']) == 6000
    assert all(row['content'] == content and row['id'] == index for index, row in enumerate(result['messages']))
    assert peak - retained < 12 * CHUNK_BYTES
