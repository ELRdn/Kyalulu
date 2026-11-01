"""Synthetic SDK/glue checks, not native compilation or real tokenizer acceptance.

Apply chat-count.patch with -p1 at the PLE-patched wllama 3.8.1 root, then
run `node cpp/generate_glue_prototype.js` there before building SDK and both
WASM variants. No SDK/artifact source is modified by these tests. Only the
four named snapshot files are optionally read; tmp_path holds fictional code.
"""

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "scripts/mobile_wasm/chat-count.patch"
SDK = ROOT / ".artifacts/mobile-wasm/wllama"
PINNED = {
    "cpp/glue.hpp": "d53c9e1e9ba733f3c370a5901dfc38c760789ebdbfc0662d52cb53b3fb521f3e",
    "cpp/wllama.cpp": "624b8419c6f591b87701a6bfe4fa372c0a3d210dc8f0a805929b624874a8638d",
    "cpp/wllama-context.h": "d969365ec6a60b5a1e36f2fd3f013b548b11339bf21102adbceec77488766a45",
    "src/wllama.ts": "d13a66e21e3dc699ca901dceea4637394b571e0955757e42657171adecb6076a",
}


def run(args, cwd, *, ok=True):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=40)
    if ok:
        assert result.returncode == 0, result.stdout + result.stderr
    return result


def hunks():
    """Read unified hunks; no patch engine or source serializer in product code."""
    sections = {}
    name = None
    current = None
    for line in PATCH.read_text(encoding="utf-8").splitlines(keepends=True):
        if line.startswith("--- a/"):
            name = line[6:].strip()
            sections[name] = []
            current = None
        elif line.startswith("+++ "):
            assert line == f"+++ b/{name}\n"
        elif line.startswith("@@ "):
            match = re.fullmatch(r"@@ -(\d+),(\d+) \+(\d+),(\d+) @@.*\n", line)
            assert match
            current = (int(match[1]), [])
            sections[name].append(current)
        else:
            assert current is not None and line[0] in " +-"
            current[1].append(line)
    assert set(sections) == set(PINNED)
    return sections


@pytest.fixture
def patched(tmp_path):
    """Only patch contexts plus padding, never a copied SDK/build tree."""
    for name, changes in hunks().items():
        lines = []
        for start, diff in changes:
            assert len(lines) <= start - 1
            lines.extend(["// fictional omitted source\n"] * (start - 1 - len(lines)))
            lines.extend(line[1:] for line in diff if line[0] in " -")
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("".join(lines), encoding="utf-8")
    run(["git", "apply", "--check", str(PATCH)], tmp_path)
    run(["git", "apply", str(PATCH)], tmp_path)
    assert run(["git", "apply", "--check", str(PATCH)], tmp_path, ok=False).returncode
    run(["git", "apply", "--reverse", "--check", str(PATCH)], tmp_path)
    return tmp_path


def test_pinned_snapshot_read_only():
    if not all((SDK / name).is_file() for name in PINNED):
        pytest.skip("Optional pinned source snapshot is not present")
    before = {name: hashlib.sha256((SDK / name).read_bytes()).hexdigest() for name in PINNED}
    assert before == PINNED, "Pinned PLE snapshot changed; review patch against the new source"
    run([
        "git", "apply", "--check", "--directory=.artifacts/mobile-wasm/wllama", str(PATCH)
    ], ROOT)
    assert before == {name: hashlib.sha256((SDK / name).read_bytes()).hexdigest() for name in PINNED}


def test_native_route_has_only_parse_template_tokenize(patched):
    context = (patched / "cpp/wllama-context.h").read_text(encoding="utf-8")
    native = context.split("  glue_msg_count_chat_res action_count_chat_tokens(", 1)[1]
    native = native.split("  glue_msg_completion_res action_completion(", 1)[0]
    assert 'oaicompat_chat_params_parse(body, meta->chat_params, files)' in native
    assert 'tokenize_mixed(vocab, parsed.at("prompt"), true, true)' in native
    assert 'if (!ctx || !vocab || !meta)' in native
    assert 'message.at("content").is_string()' in native
    assert 'role != "system" && role != "user" && role != "assistant"' in native
    assert '!files.empty() || !parsed.at("prompt").is_string()' in native
    assert 'body.contains("files")' in native
    assert 'req.data_json.value.size() > max_bytes' in native
    assert 'get<std::string>().size() > max_bytes' in native
    assert 'std::numeric_limits<int32_t>::max()' in native
    assert 'depth > 32' in native
    assert native.index('req.data_json.value.size()') < native.index('json::parse(')
    assert native.index('get<std::string>()') < native.index('tokenize_mixed(')
    assert native.index('std::numeric_limits<int32_t>::max()') < native.index('static_cast<int32_t>')
    assert 'catch (const std::exception & e)' in native and 'catch (...)' in native
    assert native.count('return res;') == 1
    assert not re.search(
        r'\b(?:task_queue|queue_tasks|server_task|server_response_reader|register_reader|'
        r'next_req_id|llama_decode|llama_encode|llama_memory|sampler|rng|mobile_ple|'
        r'get_media_marker|create_completion_task)\b', native
    )
    dispatcher = (patched / "cpp/wllama.cpp").read_text(encoding="utf-8")
    assert dispatcher.count('WLLAMA_ACTION(count_chat_tokens)') == 1
    sdk = (patched / "src/wllama.ts").read_text(encoding="utf-8")
    assert sdk.count('GlueMsgCountChatRes,') == 1
    assert 'async countChatTokens(options: ChatCompletionParams): Promise<number>' in sdk
    assert 'this.proxy.wllamaAction<GlueMsgCountChatRes>' in sdk


@pytest.mark.parametrize("snapshot", [True, False])
def test_public_method_and_generated_glue_synthetic(patched, monkeypatch, snapshot):
    if not snapshot:
        monkeypatch.setitem(globals(), "SDK", patched / 'no-optional-snapshot')
    node = shutil.which("node")
    assert node, "Node is required for the public method synthetic check"
    # Installed TypeScript is read-only. Do not install packages or use npx.
    ts_path = ROOT / "apps/web/node_modules/typescript/lib/typescript.js"
    assert ts_path.is_file(), "Use the existing web workspace TypeScript dependency"
    source = (patched / "src/wllama.ts").read_text(encoding="utf-8")
    method = source.split('  async countChatTokens(', 1)[1]
    method = '  async countChatTokens(' + method.split('  /**\n   * Make chat completion', 1)[0]
    schema = (patched / "cpp/glue.hpp").read_text(encoding="utf-8")
    schema = '#define GLUE_VERSION 1\nstruct glue_msg_count_chat_req' + schema.split('struct glue_msg_count_chat_req', 1)[1]
    schema = schema.split('struct glue_msg_completion_req', 1)[0]
    assert re.findall(r'GLUE_HANDLER\("([a-z_]+)"\)', schema) == ['ctok_req', 'ctok_res']
    assert re.findall(r'GLUE_FIELD\((\w+), (\w+)\)', schema) == [
        ('str', 'data_json'), ('bool', 'success'), ('int', 'input_tokens'), ('str', 'error'),
    ]
    # Run the real schema generator against the fictional schema, not SDK files.
    generator = SDK / 'cpp/generate_glue_prototype.js'
    if generator.is_file():
        (patched / 'cpp/glue.hpp').write_text(schema, encoding='utf-8')
        (patched / 'src/glue').mkdir()
        run([node, '--input-type=module', '-e', generator.read_text(encoding='utf-8')], patched)
        generated = (patched / 'src/glue/messages.ts').read_text(encoding='utf-8')
        assert 'export interface GlueMsgCountChatRes' in generated
        assert '_name: "ctok_res"' in generated
        assert 'input_tokens: number' in generated
    # Compare the real existing createChatCompletion dispatch/defaults when available.
    creation = PINNED_CREATE_CHAT_COMPLETION
    error_class = "class WllamaError extends Error { constructor(message, type) { super(message); this.type = type; } }"
    if (SDK / 'src/wllama.ts').is_file():
        original = (SDK / 'src/wllama.ts').read_text(encoding='utf-8')
        creation = original.split('  async createChatCompletion(\n    options: ChatCompletionParams\n', 1)[1]
        creation = '  async createChatCompletion(\n    options: ChatCompletionParams\n' + creation.split('  /**\n   * Make (raw) completion', 1)[0]
        error_class = original.split('export class WllamaError extends Error {', 1)[1].split('\n/**', 1)[0]
        error_class = 'class WllamaError extends Error {' + error_class
    (patched / 'fixture.json').write_text(json.dumps({
        'method': method, 'creation': creation, 'errorClass': error_class,
        'tsPath': str(ts_path),
    }), encoding='utf-8')
    script = patched / 'synthetic.cjs'
    script.write_text(NODE_SELF_CHECK, encoding='utf-8')
    result = run([node, str(script)], patched)
    assert 'synthetic public method checks passed' in result.stdout


# Pinned 3.8.1 dispatch reference for CI without the optional artifact snapshot.
PINNED_CREATE_CHAT_COMPLETION = """
  async createChatCompletion(options: any) {
    if (Object.keys(this.chatTemplateKwargs).length > 0) {
      options = {
        ...options,
        chat_template_kwargs: {
          ...this.chatTemplateKwargs,
          ...(options.chat_template_kwargs ?? {}),
        },
      };
    }
    if (options.stream && options.onData) {
      await this.createCompletionImpl(options);
    } else if (options.stream) {
      return await this.createCompletionGenerator(options);
    } else {
      return await this.createCompletionImpl({ ...options, stream: false });
    }
  }
"""


NODE_SELF_CHECK = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const data = JSON.parse(fs.readFileSync('fixture.json', 'utf8'));
const ts = require(data.tsPath);
const MAX = 4 * 1024 * 1024;
let serializations = 0, encodings = 0, calls = 0;
const native = { _name: 'ctok_res', success: true, input_tokens: 1792, error: '' };
let response = native, proxyError = false, onNative;
const seen = [];
const fixture = `
${data.errorClass}
class Wllama {
  chatTemplateKwargs = {};
  loaded = true;
  seed: number | undefined;
  proxy = { wllamaAction: async <T>(action: string, packet: any): Promise<T> => bridge(action, packet) };
  checkModelLoaded() { if (!this.loaded) throw new WllamaError('not loaded', 'model_not_loaded'); }
  async createCompletionImpl(options: any) { return capture(options, this.seed); }
  async createCompletionGenerator(options: any) { return capture(options, this.seed); }
${data.method}
${data.creation}
}
globalThis.Wllama = Wllama;
globalThis.WllamaError = WllamaError;
`;
const compiled = ts.transpileModule(fixture, {
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
assert.equal((compiled.diagnostics || []).length, 0);
// One realm preserves Object/Array prototypes used by the preflight.
globalThis.bridge = async (action, packet) => {
  ++calls;
  assert.equal(action, 'count_chat_tokens');
  assert.equal(packet._name, 'ctok_req');
  assert.equal(Buffer.byteLength(packet.data_json) <= MAX, true);
  seen.push(JSON.parse(packet.data_json));
  if (onNative) onNative();
  if (proxyError) throw Error('synthetic worker transport failure');
  return response;
};
globalThis.capture = (options, seed) => JSON.parse(JSON.stringify({
  ...options, ...(seed === undefined ? {} : { seed }),
}));
vm.runInThisContext(compiled.outputText);
const w = new Wllama();
const turn = (role = 'user', content = '日本語\u0000🫖 <bos>') => ({ role, content });
const options = () => ({ messages: [turn()] });
const typed = error => error instanceof WllamaError && error.type === 'inference_error';
const before = () => [serializations, encodings, calls];
const originalStringify = JSON.stringify, OriginalEncoder = TextEncoder;
JSON.stringify = function (...args) { ++serializations; return originalStringify.apply(this, args); };
globalThis.TextEncoder = class extends OriginalEncoder {
  encode(input) { ++encodings; assert.ok(Buffer.byteLength(input) <= MAX); return super.encode(input); }
};
(async () => {
  for (const defaults of [{}, { enable_thinking: false, style: 'default' }]) {
    w.chatTemplateKwargs = defaults;
    for (const stream of [undefined, false, true]) {
      for (const loadedSeed of [undefined, 73]) {
        w.seed = loadedSeed;
        const request = {
          ...options(), ...(stream === undefined ? {} : { stream }), seed: 5,
          chat_template_kwargs: { style: 'request', enable_thinking: false },
          grammar: 'root ::= "ok"', reasoning_budget_tokens: 0, reasoning_format: 'none',
          add_generation_prompt: true, continue_final_message: false,
          cache_prompt: true, temperature: 0.4, max_tokens: 256,
          response_format: { type: 'text' }, user: 'exact metadata',
          tools: [{ type: 'function', function: { name: 'tool', parameters: { type: 'object' } } }],
        };
        const unchanged = originalStringify(request);
        assert.equal(await w.countChatTokens(request), 1792);
        assert.deepEqual(seen.at(-1), await w.createChatCompletion(request));
        assert.equal(originalStringify(request), unchanged);
        assert.equal(seen.at(-1).chat_template_kwargs.enable_thinking, false);
      }
    }
  }
  w.chatTemplateKwargs = { enable_thinking: false, style: 'default' };
  await w.countChatTokens(options());
  assert.deepEqual(seen.at(-1).chat_template_kwargs, w.chatTemplateKwargs);
  await w.countChatTokens({ ...options(), chat_template_kwargs: { enable_thinking: true } });
  assert.equal(seen.at(-1).chat_template_kwargs.enable_thinking, true);
  w.loaded = false;
  const unloaded = before();
  await assert.rejects(w.countChatTokens(options()), e => e.type === 'model_not_loaded');
  assert.deepEqual(before(), unloaded);
  w.loaded = true;
  const aborted = new AbortController(); aborted.abort();
  const abortBefore = before();
  await assert.rejects(w.countChatTokens({ ...options(), abortSignal: aborted.signal }), e => e.name === 'AbortError');
  assert.deepEqual(before(), abortBefore);
  const during = new AbortController();
  onNative = () => during.abort();
  await assert.rejects(w.countChatTokens({ ...options(), abortSignal: during.signal }), e => e.name === 'AbortError');
  onNative = undefined;
  for (const invalid of [null, {}, undefined, { ...native, _name: 'wrong' },
      { ...native, success: 1 }, { ...native, success: false, error: 'synthetic template failure' },
      { ...native, error: 'unexpected' }, { ...native, error: undefined },
      ...[-1, 1.5, NaN, Infinity, 0x80000000, Number.MAX_SAFE_INTEGER, '1792'].map(input_tokens => ({ ...native, input_tokens }))]) {
    response = invalid;
    await assert.rejects(w.countChatTokens(options()), typed);
  }
  for (const count of [0, 0x7fffffff]) {
    response = { ...native, input_tokens: count };
    assert.equal(await w.countChatTokens(options()), count);
  }
  response = { ...native, success: false, error: 'synthetic invalid JSON/template/count error' };
  await assert.rejects(w.countChatTokens(options()), /synthetic invalid JSON/);
  response = native; proxyError = true;
  await assert.rejects(w.countChatTokens(options()), typed);
  proxyError = false;
  const oversized = 'x'.repeat(MAX);
  const cyclic = {}; cyclic.self = cyclic;
  const toJSON = { toJSON() { throw Error('must not serialize'); } };
  const arrayToJSON = []; Object.defineProperty(arrayToJSON, 'toJSON', { value: () => oversized });
  const getter = {}; Object.defineProperty(getter, 'boom', {
    enumerable: true, get() { throw Error('must not execute metadata getter'); },
  });
  const hiddenAbort = options(); Object.defineProperty(hiddenAbort, 'abortSignal', {
    get() { throw Error('must not execute hidden signal getter'); },
  });
  const hiddenMessage = { role: 'user' }; Object.defineProperty(hiddenMessage, 'content', {
    get() { throw Error('must not execute hidden message getter'); },
  });
  const sparse = []; sparse.length = 65537;
  for (const invalid of [null, {}, { messages: [] }, { messages: [null] },
      { messages: [turn('tool')] }, { messages: [turn('developer')] },
      { messages: [turn('user', [{ type: 'image', data: new ArrayBuffer(0) }])] },
      { messages: [turn('assistant', null)] }, { ...options(), files: [] },
      { messages: [turn('user', oversized)] }, { messages: [turn('user', 'a'.repeat(700000))] },
      { ...options(), grammar: oversized }, { ...options(), chat_template_kwargs: { huge: oversized } },
      { ...options(), response_format: { type: 'json_schema', json_schema: { schema: oversized } } },
      { ...options(), metadata: { ['k'.repeat(MAX)]: true } },
      { ...options(), metadata: new Uint8Array(MAX) }, { ...options(), metadata: sparse },
      { ...options(), metadata: Array(65536).fill(null) },
      { ...options(), metadata: cyclic }, { ...options(), metadata: toJSON },
      { ...options(), metadata: arrayToJSON }, { ...options(), metadata: getter },
      hiddenAbort, { messages: [hiddenMessage] },
      { ...options(), metadata: 1n }, { ...options(), temperature: Infinity }]) {
    const checkpoint = before();
    await assert.rejects(w.countChatTokens(invalid), typed);
    assert.deepEqual(before(), checkpoint, 'reject before stringify/encoder/native');
  }
  w.chatTemplateKwargs = { huge: oversized };
  const checkpoint = before();
  await assert.rejects(w.countChatTokens(options()), typed);
  assert.deepEqual(before(), checkpoint);
  w.chatTemplateKwargs = {};
  // Exercise worst-case escaping and Unicode within the conservative bound.
  for (const content of ['\u0000'.repeat(50000), '😀'.repeat(50000), 'a'.repeat(500000)]) {
    assert.equal(await w.countChatTokens({ messages: [turn('user', content)] }), 1792);
  }
  assert.equal(await w.countChatTokens(options()), 1792, 'failure must allow next valid call');
  console.log('synthetic public method checks passed');
})().finally(() => { JSON.stringify = originalStringify; globalThis.TextEncoder = OriginalEncoder; })
  .catch(error => { console.error(error); process.exitCode = 1; });
"""
