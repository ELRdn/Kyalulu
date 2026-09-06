"""Inert image upload verification using Pillow's decoder and pixel limits."""
import hashlib
import io
import warnings


def accept_image(raw: bytes):
    from PIL import Image
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError('Image exceeds 16 MiB')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as im:
                mime = {'PNG': 'image/png', 'JPEG': 'image/jpeg', 'WEBP': 'image/webp', 'GIF': 'image/gif'}.get(im.format)
                if not mime or im.width * im.height > 32_000_000:
                    raise ValueError('Unsupported image or too many pixels')
                im.verify()
    except Exception as exc:
        raise ValueError('Invalid or unsupported image') from exc
    return hashlib.sha256(raw).hexdigest(), mime
