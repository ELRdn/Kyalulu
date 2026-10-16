import io
import struct
import wave

import httpx
import pytest
from python.api.main import app
from python.core.portable_assets import accept_media
from python.core.portable_formats import parse_import
from python.core.portable_export import export_document
from python.core.portable_schema import PortableDocument, PortableAsset


def wav():
    output=io.BytesIO()
    with wave.open(output,'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
        audio.writeframes(b'\0\0'*800)
    return output.getvalue()


def atom(kind, data):
    return struct.pack('>I4s',len(data)+8,kind)+data


def test_media_structure_limits_and_no_external_references():
    raw=wav()
    assert accept_media(raw)[1]=='audio/wav'
    with pytest.raises(ValueError):
        accept_media(raw[:-2])
    with pytest.raises(ValueError):
        accept_media(b'<html><script>bad()</script></html>')
    header=atom(b'ftyp',b'isom'+b'\0'*4+b'mp42')
    # Container acceptance alone does not certify playable codecs; real decoder acceptance is separate.
    assert accept_media(header+atom(b'moov',b'')+atom(b'mdat',b'fixture'))[1]=='video/mp4'
    with pytest.raises(ValueError,match='External'):
        accept_media(header+atom(b'moov',atom(b'dref',b'\0'*4+struct.pack('>I',1)+atom(b'url ',b'\0'*4+b'https://example.test')))+atom(b'mdat',b'fixture'))
    with pytest.raises(ValueError):
        accept_media(header+struct.pack('>I4s',0xffffffff,b'moov'))


@pytest.mark.asyncio
async def test_local_audio_upload_rights_mime_and_portable_roundtrip(isolated):
    raw=wav()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        denied=await client.post('/api/library/assets',files={'file':('clip.wav',raw,'audio/wav')})
        assert denied.status_code==400
        result=await client.post('/api/library/assets',data={'rights_confirmed':'true'},files={'file':('clip.wav',raw,'text/html')})
        assert result.status_code==200,result.text
        asset=PortableAsset.model_validate(result.json())
        response=await client.get('/api/library/assets/'+asset.asset_id)
        assert response.content==raw and response.headers['content-type'].startswith('audio/wav')
        assert 'nosniff' in response.headers['x-content-type-options'].split(', ')
        document=PortableDocument(name='Original audio',assets=[asset])
        archive,_,_,_=export_document(document,'backup',{asset.asset_id:(raw,'audio/wav')})
        restored, assets=parse_import('original.kyalulu.zip',archive)
        assert restored[0].assets[0].asset_id==asset.asset_id and assets[asset.asset_id][0]==raw
