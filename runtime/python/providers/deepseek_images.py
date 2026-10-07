"""Bounded inline vision inputs for the official DeepSeek Flash endpoint.

External URLs and Files API references are intentionally unsupported here: only
validated local bytes are sent, without a remote fetch or retained provider file.
"""

import base64
import io
import warnings

MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGES = 4
IMAGE_TOKENS = 1024  # Official upper bound per image, independent of dimensions.


def image_block(raw, mime):
    from PIL import Image

    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_IMAGE_BYTES:
        raise ValueError("deepseek_image_size_invalid")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                actual = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}.get(image.format)
                if (
                    actual != mime or actual is None
                    or max(image.size) > 8192 or image.width * image.height > 16_000_000
                    or getattr(image, "n_frames", 1) != 1
                ):
                    raise ValueError("deepseek_image_format_invalid")
                image.load()  # Decode fully; magic bytes alone do not verify an image.
    except Exception as exc:
        raise ValueError("deepseek_image_invalid") from exc
    return {"type": "image_url", "image_url": {
        "url": "data:" + mime + ";base64," + base64.b64encode(raw).decode("ascii"),
        "detail": "original",
    }}


def vision_messages(prompt, messages):
    from . import resolve_messages

    if messages is None:
        return resolve_messages(prompt)
    if not isinstance(messages, list):
        raise ValueError("deepseek_messages_invalid")
    result, images = [], 0
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("deepseek_messages_invalid")
        content = message.get("content", "")
        if not isinstance(content, list):
            result.extend(resolve_messages(messages=[message]))
            continue
        if message.get("role", "user") != "user":
            raise ValueError("deepseek_images_require_user_role")
        blocks = []
        for block in content:
            if not isinstance(block, dict):
                raise ValueError("deepseek_content_invalid")
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                blocks.append({"type": "text", "text": block["text"]})
                continue
            if block.get("type") != "image_url" or not isinstance(block.get("image_url"), dict):
                raise ValueError("deepseek_content_invalid")
            url = block["image_url"].get("url", "")
            if not isinstance(url, str) or len(url) > MAX_IMAGE_BYTES * 4 // 3 + 100:
                raise ValueError("deepseek_image_size_invalid")
            header, separator, encoded = url.partition(",")
            if not separator or header not in {
                "data:image/png;base64", "data:image/jpeg;base64",
                "data:image/webp;base64", "data:image/gif;base64",
            }:
                raise ValueError("deepseek_inline_images_only")
            images += 1
            if images > MAX_IMAGES:
                raise ValueError("deepseek_image_count_exceeded")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except ValueError as exc:
                raise ValueError("deepseek_image_invalid") from exc
            blocks.append(image_block(raw, header[5:-7]))
        result.append({"role": "user", "content": blocks})
    return result
