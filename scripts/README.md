# scripts
`verify_lmstudio_vulkan.py` は指定Gemma 4をRX7600 / Vulkanで読み込み、既存キャラの構造化応答を検証する。

`verify_portable_vulkan.py` は同じ指定GGUFで、取り込んだSFWカードのLoreと構造化応答を最大300秒の生成枠で確認する。実行前にVulkanの選択とRX7600以外のGPU無効化を検証し、終了後は専用モデルインスタンスをアンロードする。
CPU専用・他GPUへの自動切替は行わない。結果は `.artifacts/portable-vulkan.json`。

再実行条件と直近の実測は [互換受け入れ記録](../docs/COMPATIBILITY_ACCEPTANCE.md) を参照。
