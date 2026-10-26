"""Apply the bounded Gemma4 PLE row-streaming patch to pinned wllama/llama.cpp.

Source roots are .artifacts/mobile-wasm/wllama (3.8.1) and sibling llama.cpp
(46ca246de9bb1c35269722a6240d37d9dfd79cad). No model tensors are modified.
The generated ple.patch is published with runtime source and build evidence.
"""
from pathlib import Path
import difflib
import shutil

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.artifacts/mobile-wasm'
W = WORK / 'wllama'
L = W / 'llama.cpp'
originals = {}


def edit(path, old, new):
    p = W / path
    before = p.read_text(encoding='utf-8')
    if new in before:
        return
    if before.count(old) != 1:
        raise RuntimeError(f'Pinned source differs: {path} ({before.count(old)} matches)')
    originals.setdefault(path, before)
    after = before.replace(old, new)
    p.write_text(after, encoding='utf-8', newline='\n')


def main():
    src = WORK / 'llama.cpp'
    if src.exists():
        if not src.resolve().is_relative_to(WORK.resolve()) or not L.resolve().is_relative_to(WORK.resolve()):
            raise RuntimeError('Source move escaped workspace')
        if L.exists():
            L.rmdir()  # Only the empty archive's submodule placeholder.
        shutil.move(str(src), str(L))
    edit('CMakeLists.txt', 'option(WLLAMA_TEST_BACKEND', 'add_compile_definitions(KYALULU_MOBILE_PLE=1)\n\noption(WLLAMA_TEST_BACKEND')
    edit('llama.cpp/src/llama-model.h', '    // which tensors can be prefetched - driven by TENSOR_READ_LAZY', '''    // Kyalulu: only the metadata and one source handle survive for the PLE table.
    ggml_context_ptr mobile_ple_ctx;
    std::unique_ptr<struct llama_file> mobile_ple_file;
    size_t mobile_ple_offset = 0;
    uint32_t mobile_ple_file_index = 0;
    mutable uint64_t mobile_ple_bytes_read = 0;

    // which tensors can be prefetched - driven by TENSOR_READ_LAZY''')
    edit('llama.cpp/src/llama-model.cpp', '''ggml_tensor * llama_model_base::create_tensor(llama_model_loader & ml, const LLM_TN_IMPL & tn, const std::initializer_list<int64_t> & ne, int flags) {
    const buft_list_t''', '''ggml_tensor * llama_model_base::create_tensor(llama_model_loader & ml, const LLM_TN_IMPL & tn, const std::initializer_list<int64_t> & ne, int flags) {
#ifdef KYALULU_MOBILE_PLE
    if (arch == LLM_ARCH_GEMMA4 && tn.tensor == LLM_TENSOR_PER_LAYER_TOKEN_EMBD && !ml.files.empty()) {
        const auto * meta = ml.check_tensor_dims(tn.str(), ne, true, false);
        const auto & weight = ml.require_weight(tn.str().c_str());
        if (!meta || !ggml_get_type_traits(meta->type)->to_float) {
            throw std::runtime_error("unsupported PLE row type; refusing full-table fallback");
        }
        mobile_ple_ctx.reset(ggml_init({ggml_tensor_overhead() + 1024, nullptr, true}));
        if (!mobile_ple_ctx) { throw std::runtime_error("PLE metadata allocation failed"); }
        auto * tensor = ggml_dup_tensor(mobile_ple_ctx.get(), meta);
        ggml_set_name(tensor, tn.str().c_str());
        mobile_ple_offset = weight.offs;
        mobile_ple_file_index = weight.idx;
        ++ml.n_created;
        return tensor;
    }
#endif
    const buft_list_t''')
    edit('llama.cpp/src/llama-model.cpp', '''    return true;
}

ggml_tensor * llama_model_base::create_tensor''', '''    if (mobile_ple_ctx) {
        mobile_ple_file = std::move(ml.files.at(mobile_ple_file_index));
        LLAMA_LOG_INFO("kyalulu: PLE row streaming enabled; full table is not allocated\\n");
    }
    return true;
}

ggml_tensor * llama_model_base::create_tensor''')
    edit('llama.cpp/src/models/gemma4.cpp', '#include "llama-impl.h"', '#include "llama-impl.h"\n#include "llama-mmap.h"')
    edit('llama.cpp/src/models/gemma4.cpp', '''        ggml_tensor * ple = model.per_layer_tok_embd;

        const bool prefetch''', '''        ggml_tensor * ple = model.per_layer_tok_embd;
        if (rows) {
            if (!model.mobile_ple_file) { throw std::runtime_error("PLE source not open"); }
            const size_t width = ple->ne[0];
            const size_t row_bytes = ggml_row_size(ple->type, width);
            const int32_t count = ubatch->token ? ubatch->n_tokens : 1;
            std::vector<uint8_t> packed(row_bytes);
            std::vector<float> values(width * count);
            const auto dequantize = ggml_get_type_traits(ple->type)->to_float;
            for (int32_t i = 0; i < count; ++i) {
                const int32_t token = ubatch->token ? ubatch->token[i] : 0;
                if (token < 0 || token >= ple->ne[1]) { throw std::runtime_error("PLE token out of range"); }
                model.mobile_ple_file->seek(model.mobile_ple_offset + size_t(token) * row_bytes, SEEK_SET);
                model.mobile_ple_file->read_raw(packed.data(), row_bytes);
                model.mobile_ple_bytes_read += row_bytes;
                dequantize(packed.data(), values.data() + size_t(i) * width, width);
            }
            ggml_backend_tensor_set(rows, values.data(), 0, values.size() * sizeof(float));
            return;
        }

        const bool prefetch''')
    edit('llama.cpp/src/models/gemma4.cpp', '''        return params.ubatch.token ? tokens && tokens->ne[0] == params.ubatch.n_tokens : tokens == nullptr;
    }

    ggml_tensor * tokens = nullptr;''', '''        if (rows) { return rows->ne[1] == (params.ubatch.token ? params.ubatch.n_tokens : 1); }
        return params.ubatch.token ? tokens && tokens->ne[0] == params.ubatch.n_tokens : tokens == nullptr;
    }

    ggml_tensor * rows = nullptr;
    ggml_tensor * tokens = nullptr;''')
    edit('llama.cpp/src/models/gemma4.cpp', '''    if (ubatch.token) {
        inp->tokens = ggml_new_tensor_1d''', '''    if (model.mobile_ple_ctx) {
        const int64_t count = ubatch.token ? n_tokens : 1;
        inp->rows = ggml_new_tensor_2d(ctx0, GGML_TYPE_F32, n_embd_per_layer * n_layer, count);
        ggml_set_input(inp->rows);
        inp_per_layer = ggml_reshape_3d(ctx0, inp->rows, n_embd_per_layer, n_layer, count);
        inp_per_layer = ggml_scale(ctx0, inp_per_layer, tok_embd_scale);
        cb(inp_per_layer, "inp_per_layer_streamed", -1);
    } else if (ubatch.token) {
        inp->tokens = ggml_new_tensor_1d''')
    edit('cpp/wllama.cpp', '#include "llama.h"', '#include "llama.h"\n#include "../llama.cpp/src/llama-model.h"')
    edit('cpp/wllama.cpp', 'return EM_ASM_INT(return HEAP8.length);', 'return size_t(EM_ASM_DOUBLE(return HEAP8.length));')
    edit('cpp/wllama.cpp', '''  /*json res = json{
      {"mem_total_MB", get_mem_total() / 1024 / 1024},
      {"mem_free_MB", get_mem_free() / 1024 / 1024},
      {"mem_used_MB", (get_mem_total() - get_mem_free()) / 1024 / 1024},
  };
  result = std::string(res.dump());
  return result.c_str();*/
  return nullptr;''', '''  static std::string result;
  size_t weight_bytes = 0;
  if (app.model) {
    for (const auto & entry : app.model->memory_breakdown()) { weight_bytes += entry.second; }
  }
  json metrics = {{"wasmBytes", get_mem_total()}, {"weightBufferBytes", weight_bytes},
      {"pleLazy", app.model && bool(app.model->mobile_ple_file)},
      {"plePresent", app.model && app.model->per_layer_tok_embd != nullptr},
      {"pleBytesRead", app.model ? app.model->mobile_ple_bytes_read : 0}};
  result = metrics.dump();
  return result.c_str();''')
    if originals:
        patches = []
        for path, before in originals.items():
            after = (W/path).read_text(encoding='utf-8')
            patches.extend(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile='a/'+path, tofile='b/'+path))
        (Path(__file__).parent/'ple.patch').write_text(''.join(patches), encoding='utf-8', newline='\n')
    print('Patched pinned source. PLE table remains intact; only requested rows are dequantized.')


if __name__ == '__main__':
    main()
