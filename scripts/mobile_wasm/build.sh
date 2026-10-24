#!/usr/bin/env bash
set -euo pipefail
task_root="$(cd "$(dirname "$0")/../.." && pwd)"
task_work="$task_root/.artifacts/mobile-wasm"
cd "$task_work"
chmod +x "$task_work/ninja/ninja"
source "$task_work/emsdk/emsdk_env.sh"
export PATH="$task_work/cmake-3.31.6-linux-x86_64/bin:$task_work/ninja:$PATH"
task_source="$task_work/wllama"
task_dawn="$task_work/emdawn/emdawnwebgpu_pkg"
for task_variant in standard compat; do
  task_build="$task_work/build-$task_variant"
  task_flags=()
  if [[ "$task_variant" == compat ]]; then
    task_flags+=(-DWLLAMA_COMPAT=ON -DLLAMA_WASM_MEM64=OFF -DGGML_WEBGPU_JSPI=OFF)
  else
    task_flags+=(-DGGML_WEBGPU_JSPI=ON)
  fi
  emcmake cmake -S "$task_source" -B "$task_build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -DGGML_WEBGPU=ON -DEMDAWNWEBGPU_DIR="$task_dawn" \
    -DWLLAMA_TEST_BACKEND=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF \
    "${task_flags[@]}"
  cmake --build "$task_build" --target wllama --parallel 6
done
printf 'Built standard and Safari-compatible PLE row-streaming binaries.\n'
