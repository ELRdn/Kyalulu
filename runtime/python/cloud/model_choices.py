"""Published OpenRouter choices; an unverified choice cannot dispatch a request."""
from python.providers.openrouter import DEEPSEEK, GLM, HAIKU, LUNA

# Prices are USD per million tokens, observed 2026-10-11. No cache savings assumed.
CHOICES = {
    "cloud-deepseek-baidu": {
        "display_name": "DeepSeek V4.1 Flash · Baidu", "model": DEEPSEEK,
        "upstream": "Baidu", "upstream_tag": "baidu/fp8", "prices": ("0.0348", "0.1392"),
        "reasoning_effort": "low", "reasoning_summary_supported": False,
        "retains_prompts": True,
        "training": True,
        "privacy_note": "Baiduによる会話・設定・記憶・生成結果の保存と、AIの学習・改善への利用を許可する経路です。保存期間とOpenRouter経由の特約は未確認です。利用地域外に移転・保存される場合があります。",
    },
    "cloud-deepseek-decart": {
        "display_name": "DeepSeek V4.1 Flash · Decart", "model": DEEPSEEK,
        "upstream": "Decart", "upstream_tag": "decart/fp4", "prices": ("0.09", "0.18"),
        "reasoning_effort": "low", "reasoning_summary_supported": False,
        "privacy_note": "学習利用を許可しない経路に固定します。",
    },
    "cloud-deepseek-inferencenet": {
        "display_name": "DeepSeek V4.1 Flash · InferenceNet", "model": DEEPSEEK,
        "upstream": "InferenceNet", "upstream_tag": "inference-net/fp8", "prices": ("0.077", "0.66"),
        "observed_at": "2026-10-12",
        "reasoning_effort": "low", "reasoning_summary_supported": False,
        "privacy_note": "学習利用を許可しない経路に固定します。",
    },
    "cloud-glm-inferencenet": {
        "display_name": "GLM 5.3 Flash · InferenceNet", "model": GLM,
        "upstream": "InferenceNet", "upstream_tag": "inference-net/fp4", "prices": ("0.07", "0.05"),
        "reasoning_effort": "low", "reasoning_summary_supported": False,
        "privacy_note": "学習利用を許可しない経路に固定します。",
    },
    "cloud-gpt-luna-flex": {
        "display_name": "GPT-6 Luna Flex · OpenAI", "model": LUNA,
        "upstream": "OpenAI", "upstream_tag": "openai/flex", "prices": ("0.05", "0.25"),
        "reasoning_effort": "low", "reasoning_summary_supported": True,
        "retains_prompts": True, "service_tier": "flex",
        "input_cost_ceiling": "0.0625",
        "privacy_note": "OpenAIは通常最大30日、入力・応答を含む監視ログを保持します。法令・安全上の延長があります。学習はopt-inなしで行いません。Flexは待ち時間と提供可否が変動します。",
    },
    "cloud-claude-haiku": {
        "display_name": "Claude Haiku 5.5 · Google Vertex", "model": HAIKU,
        "upstream": "Google", "upstream_tag": "google-vertex/global", "prices": ("0.10", "0.50"),
        "reasoning_effort": "low", "reasoning_summary_supported": True,
        "input_cost_ceiling": "0.20",
        "privacy_note": "Google Vertexのglobal経路へ送信。学習利用を許可しません。",
    },
}
