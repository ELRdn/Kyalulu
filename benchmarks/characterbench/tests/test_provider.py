from __future__ import annotations
import os
import unittest
from unittest.mock import patch
from kcb.providers import Provider,ProviderError,NoRedirect
from support import FakeAPI

MESSAGES=[{'role':'user','content':'短い挨拶をしてください。'}]

class ProviderTests(unittest.TestCase):
    def test_models_discovery(self):
        with FakeAPI() as api:self.assertEqual(Provider(api.config()).models(),['fixture-http'])
    def test_auto_selects_only_one(self):
        with FakeAPI() as api:self.assertEqual(Provider(api.config(model='auto')).resolve_model(),'fixture-http')
    def test_auto_refuses_multiple(self):
        with FakeAPI(models=['a','b']) as api:
            with self.assertRaises(ProviderError):Provider(api.config(model='auto')).resolve_model()
    def test_auto_refuses_none(self):
        with FakeAPI(models=[]) as api:
            with self.assertRaises(ProviderError):Provider(api.config(model='auto')).resolve_model()
    def test_json_transport(self):
        with FakeAPI(transport='json',text='こんにちは。') as api:
            result=Provider(api.config(stream=False)).generate(MESSAGES)
            self.assertEqual(result.text,'こんにちは。');self.assertIsNone(result.ttft_seconds);self.assertFalse(result.streamed)
    def test_server_nonstream_fallback_measured_honestly(self):
        with FakeAPI(transport='json') as api:
            result=Provider(api.config(stream=True)).generate(MESSAGES);self.assertIsNone(result.ttft_seconds)
    def test_sse_unicode_reassembly(self):
        with FakeAPI(text='こんにちは、星の図書室です。') as api:
            result=Provider(api.config()).generate(MESSAGES);self.assertEqual(result.text,'こんにちは、星の図書室です。');self.assertTrue(result.streamed)
    def test_ttft_ignores_role_and_reasoning(self):
        with FakeAPI(reasoning=True,role_delay=.03) as api:
            result=Provider(api.config()).generate(MESSAGES)
            self.assertGreaterEqual(result.ttft_seconds,.02);self.assertGreater(result.reasoning_chars,0)
            self.assertNotIn('not retained reasoning',str(result.record()))
    def test_usage_is_reported_not_estimated(self):
        with FakeAPI(reasoning=True) as api:
            result=Provider(api.config()).generate(MESSAGES);self.assertEqual(result.usage['prompt_tokens'],37);self.assertEqual(result.usage['reasoning_tokens'],2)
    def test_no_thinking_rejects_ignored_server_setting(self):
        for transport in ('json','sse'):
            with self.subTest(transport=transport),FakeAPI(transport=transport,reasoning=True) as api:
                config=api.config(stream=transport=='sse',require_no_reasoning=True,extra_body={'reasoning_effort':'none'})
                with self.assertRaisesRegex(ProviderError,'No-thinking check failed'):
                    Provider(config).generate(MESSAGES)
                self.assertEqual(api.requests[0]['reasoning_effort'],'none')
    def test_no_thinking_accepts_visible_only_response(self):
        with FakeAPI(usage=False) as api:
            result=Provider(api.config(require_no_reasoning=True)).generate(MESSAGES)
            self.assertEqual(result.reasoning_chars,0)
    def test_no_thinking_rejects_visible_think_tag(self):
        with FakeAPI(text='<think>private reasoning</think>Answer',usage=False) as api:
            with self.assertRaisesRegex(ProviderError,'No-thinking check failed'):
                Provider(api.config(require_no_reasoning=True)).generate(MESSAGES)
    def test_missing_usage_is_null(self):
        with FakeAPI(usage=False) as api:self.assertIsNone(Provider(api.config()).generate(MESSAGES).usage)
    def test_incomplete_stream_rejected(self):
        with FakeAPI(incomplete=True) as api:
            with self.assertRaises(ProviderError):Provider(api.config()).generate(MESSAGES)
    def test_error_object_rejected_json(self):
        with FakeAPI(transport='json',error_object=True) as api:
            with self.assertRaises(ProviderError):Provider(api.config()).generate(MESSAGES)
    def test_error_object_rejected_sse(self):
        with FakeAPI(error_object=True) as api:
            with self.assertRaises(ProviderError):Provider(api.config()).generate(MESSAGES)
    def test_malformed_response_rejected(self):
        with FakeAPI(malformed=True) as api:
            with self.assertRaises(ProviderError):Provider(api.config()).generate(MESSAGES)
    def test_empty_response_rejected(self):
        with FakeAPI(text='') as api:
            with self.assertRaises(ProviderError):Provider(api.config()).generate(MESSAGES)
    def test_http_error_no_auto_retry_no_secret_log(self):
        with FakeAPI(fail_at=1) as api,patch.dict(os.environ,{'KCB_API_KEY':'fake-secret-123'}):
            with self.assertRaises(ProviderError) as caught:Provider(api.config()).generate(MESSAGES)
            self.assertNotIn('fake-secret-123',str(caught.exception));self.assertEqual(api.count,1)
    def test_budget_extra_and_seed_forwarded(self):
        with FakeAPI() as api:
            Provider(api.config(send_seed=True,extra_body={'chat_template_kwargs':{'enable_thinking':False}})).generate(MESSAGES,seed=41)
            req=api.requests[0];self.assertEqual(req['seed'],41);self.assertEqual(req['max_tokens'],768);self.assertFalse(req['chat_template_kwargs']['enable_thinking'])
    def test_seed_not_sent_by_default(self):
        with FakeAPI() as api:
            Provider(api.config()).generate(MESSAGES,seed=41);self.assertNotIn('seed',api.requests[0])
    def test_stream_usage_opt_in(self):
        with FakeAPI() as api:
            Provider(api.config(stream_usage=True)).generate(MESSAGES);self.assertEqual(api.requests[0]['stream_options'],{'include_usage':True})
    def test_redirects_not_followed(self):self.assertIsNone(NoRedirect().redirect_request(None,None,302,'',{},'https://example.invalid/'))
    def test_length_finish_flag_preserved(self):
        with FakeAPI(finish='length') as api:self.assertEqual(Provider(api.config()).generate(MESSAGES).finish_reason,'length')

if __name__=='__main__':unittest.main()
