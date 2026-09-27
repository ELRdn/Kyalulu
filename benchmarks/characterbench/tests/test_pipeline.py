from __future__ import annotations
import copy
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from kcb.config import validate_config
from kcb.dataset import load_dataset
from kcb.judging import natural_targets,rubric_judge,validate_rubric,response_snapshot_hash,validate_pair
from kcb.providers import Provider,Generation,ProviderError
from kcb.runner import run_benchmark,load_run,regrade_run,Store
from kcb.report import build_report
from kcb.grading import evaluate
from kcb.comparison import compare_runs,pairwise_judge
from kcb.util import KCBError,load_json,save_json,read_jsonl,write_jsonl,dumps
from support import FakeAPI

MOCK=validate_config({'provider':'mock','model':'fixture','label':'MOCK test fixture'})
BROKEN=validate_config({'provider':'mock','model':'broken','label':'MOCK broken test fixture'})

class PipelineTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def test_full_dataset_runs_264_generations(self):
        summary=run_benchmark(MOCK,self.root/'full',quiet=True)
        self.assertEqual(summary['recorded_generations'],264);self.assertEqual(summary['diagnostic_accuracy']['mean'],1)
        self.assertEqual(summary['semantic_state'],'not_evaluated');self.assertTrue(summary['mock'])
    def test_reports_and_snapshots_exist(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='smoke',quiet=True)
        for filename in ('report.html','summary.json','scores.csv','responses.jsonl','manifest.json','run.sqlite3','dataset/cases.jsonl'):
            self.assertTrue((out/filename).is_file(),filename)
        summary=load_json(out/'summary.json')
        self.assertEqual(set(summary['natural_surface_by_mode']),{'natural','dialogue'})
        self.assertEqual(summary['responses_with_separate_reasoning'],0)
    def test_resume_preserves_completed_records(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='smoke',quiet=True);before=Store(out).rows()
        with patch.object(Provider,'generate',side_effect=AssertionError('must not generate on completed resume')):
            run_benchmark(MOCK,out,suite='smoke',resume=True,quiet=True)
            run_benchmark(MOCK,out,suite='smoke',resume=True,retry_errors=True,retry_workers=1,quiet=True)
        self.assertEqual(before,Store(out).rows())
        self.assertFalse((out/'retry_attempts.jsonl').exists())
        self.assertEqual(load_json(out/'manifest.json')['retry_events'],[])
    def test_refuse_overwrite(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='smoke',quiet=True)
        with self.assertRaises(KCBError):run_benchmark(MOCK,out,suite='smoke',quiet=True)
    def test_resume_changed_model_rejected(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='smoke',quiet=True)
        with self.assertRaises(KCBError):run_benchmark(BROKEN,out,suite='smoke',resume=True,quiet=True)
    def test_resume_changed_seed_rejected(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='smoke',quiet=True)
        with self.assertRaises(KCBError):run_benchmark(MOCK,out,suite='smoke',seed=42,resume=True,quiet=True)
    def test_retry_flag_requires_resume(self):
        with self.assertRaises(KCBError):run_benchmark(MOCK,self.root/'r',retry_errors=True,quiet=True)
        with self.assertRaises(KCBError):run_benchmark(MOCK,self.root/'r',retry_workers=1,quiet=True)
    def test_concurrency_keeps_unique_rows(self):
        out=self.root/'r';s=run_benchmark(MOCK,out,workers=4,quiet=True)
        rows=Store(out).rows();self.assertEqual(len(rows),264);self.assertEqual(len({r['key'] for r in rows}),264);self.assertEqual(s['successful_generations'],264)
    def test_three_repeats_keep_character_cluster_count(self):
        s=run_benchmark(MOCK,self.root/'r',suite='diagnostic',repeats=3,quiet=True)
        self.assertEqual(s['recorded_generations'],144);self.assertEqual(s['diagnostic_accuracy']['clusters'],12)
    def test_diagnostic_field_breakdown_preserves_strict_oracle(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='diagnostic',quiet=True)
        data=load_dataset(out/'dataset')
        unit=next(u for u in data['units'] if u['id']=='c01.knowledge_boundary')
        row=next(r for r in Store(out).rows() if r['unit_id']==unit['id'])
        expected=unit['turns'][0]['eval']['gold']
        row['text']=dumps({'world_location':expected['world_location'],'character_belief':'誤答'})
        row['evaluation']=evaluate(row['text'],unit['turns'][0]['eval']['checks'])
        Store(out).put(row)
        summary=build_report(out)
        self.assertEqual(summary['diagnostic_fields']['knowledge_boundary']['world_location']['mean'],1)
        self.assertAlmostEqual(summary['diagnostic_fields']['knowledge_boundary']['character_belief']['mean'],11/12)
        self.assertAlmostEqual(summary['diagnostic_accuracy']['mean'],47/48)
        row['text']=dumps(expected | {'unexpected':'extra'})
        Store(out).put(row)
        summary=build_report(out)
        self.assertAlmostEqual(summary['diagnostic_fields']['knowledge_boundary']['world_location']['mean'],11/12)
    def test_explicit_regrade_archives_old_checks_without_model_calls(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='dialogue',limit_units=1,quiet=True)
        row=Store(out).rows()[0]
        row['text']='了解。\n・準備開始：16:10'
        self.assertTrue(row['evaluation']['all_pass'])
        Store(out).put(row)
        manifest=load_json(out/'manifest.json')
        manifest['grading_version']='0.1.1'
        save_json(out/'manifest.json',manifest)
        with patch.object(Provider,'generate',side_effect=AssertionError('regrade must be offline')):
            summary=regrade_run(out)
        self.assertEqual(summary['regrade_events'],1)
        self.assertEqual(summary['regrade_pass_fail_changes'],1)
        self.assertEqual(summary['grading_version'],'0.1.2')
        self.assertFalse(Store(out).rows()[0]['evaluation']['all_pass'])
        self.assertTrue(any(a['key']==row['key'] and a['old_evaluation']['all_pass'] and not a['new_evaluation']['all_pass']
                            for a in read_jsonl(out/'regrade_history.jsonl')))
        with self.assertRaises(KCBError):regrade_run(out)
    def test_http_failure_blocks_later_turns_and_can_be_retried(self):
        with FakeAPI(fail_at=3) as api:
            out=self.root/'r';config=api.config()
            s=run_benchmark(config,out,suite='dialogue',limit_units=1,workers=2,quiet=True)
            self.assertEqual(s['status_counts'],{'ok':2,'error':1,'skipped_dependency':9});self.assertEqual(api.count,3)
            old=Store(out).rows()[:2]
            s=run_benchmark(config,out,suite='dialogue',limit_units=1,workers=2,resume=True,retry_errors=True,retry_workers=1,quiet=True)
            self.assertEqual(s['successful_generations'],12);self.assertEqual(api.count,13);self.assertEqual(Store(out).rows()[:2],old)
            attempts=read_jsonl(out/'retry_attempts.jsonl')
            self.assertEqual(len(attempts),10)
            self.assertEqual([a['record']['status'] for a in attempts].count('error'),1)
            self.assertEqual([a['record']['status'] for a in attempts].count('skipped_dependency'),9)
            manifest=load_json(out/'manifest.json')
            self.assertEqual(manifest['spec']['workers'],2)
            self.assertEqual(manifest['retry_events'][0]['retry_workers'],1)
            self.assertEqual(s['archived_retry_status_counts'],{'error':1,'skipped_dependency':9})
            self.assertTrue(any('Retry concurrency differs' in w for w in s['warnings']))
    def test_token_limit_is_saved_but_not_scored_or_replayed(self):
        with FakeAPI(text='部分的な返答',finish='length') as api:
            out=self.root/'r'
            s=run_benchmark(api.config(),out,suite='dialogue',limit_units=1,quiet=True)
            self.assertEqual(s['status_counts'],{'truncated':1,'skipped_dependency':11})
            self.assertEqual(s['truncated_responses'],1)
            self.assertEqual(s['semantic_coverage']['complete_eligible_targets'],0)
            self.assertEqual(api.count,1)
            first=Store(out).rows()[0]
            self.assertEqual(first['text'],'部分的な返答')
            self.assertIsNone(first['evaluation'])
    def test_nonnormal_finish_is_saved_but_not_scored_or_replayed(self):
        with FakeAPI(text='検閲前の断片',finish='content_filter') as api:
            out=self.root/'r'
            s=run_benchmark(api.config(),out,suite='dialogue',limit_units=1,quiet=True)
            self.assertEqual(s['status_counts'],{'error':1,'skipped_dependency':11})
            self.assertEqual(api.count,1)
            first=Store(out).rows()[0]
            self.assertEqual(first['text'],'検閲前の断片')
            self.assertIsNone(first['evaluation'])
    def test_followup_contains_actual_candidate_reply(self):
        with FakeAPI(text='これは実際に返した固定応答です。') as api:
            run_benchmark(api.config(),self.root/'r',suite='dialogue',limit_units=1,quiet=True)
            self.assertEqual(api.requests[1]['messages'][-2],{'role':'assistant','content':'これは実際に返した固定応答です。'})
            self.assertEqual(len(api.requests),12)
    def test_evaluation_canary_never_sent_over_http(self):
        data=load_dataset();u=copy.deepcopy(data['units'][0]);u['turns'][0]['eval']['gold']={'private':'DO_NOT_SEND_THIS_CANARY'}
        u['turns'][0]['eval']['notes']='DO_NOT_SEND_THIS_CANARY';base=self.root/'data'
        save_json(base/'characters.json',list(data['characters'].values()));write_jsonl(base/'cases.jsonl',[u])
        with FakeAPI() as api:
            run_benchmark(api.config(),self.root/'r',dataset_dir=base,quiet=True)
            self.assertNotIn('DO_NOT_SEND_THIS_CANARY',dumps(api.requests))
    def test_snapshot_tamper_detected(self):
        out=self.root/'r';run_benchmark(MOCK,out,suite='smoke',quiet=True)
        cards=load_json(out/'dataset/characters.json');cards[0]['name']='changed';save_json(out/'dataset/characters.json',cards)
        with self.assertRaises(KCBError):load_run(out)
    def test_token_cost_only_when_usage_and_rates_present(self):
        with FakeAPI() as api:
            c=api.config(input_usd_per_million=1,output_usd_per_million=2)
            s=run_benchmark(c,self.root/'r',suite='diagnostic',limit_units=1,quiet=True)
            self.assertAlmostEqual(s['cost_estimate_usd'],(37+22)/1e6)
    def test_missing_usage_is_not_zero_cost(self):
        with FakeAPI(usage=False) as api:
            s=run_benchmark(api.config(input_usd_per_million=1,output_usd_per_million=2),self.root/'r',suite='diagnostic',limit_units=1,quiet=True)
            self.assertIsNone(s['cost_estimate_usd']);self.assertEqual(s['reported_usage']['known_full_usage_responses'],0)
    def test_warmup_is_separate_from_scored_calls(self):
        with FakeAPI() as api:
            out=self.root/'r';s=run_benchmark(api.config(),out,suite='diagnostic',limit_units=1,warmup=1,quiet=True)
            self.assertEqual(api.count,2);self.assertEqual(s['recorded_generations'],1);self.assertTrue((out/'warmup.json').exists())
    def test_interrupt_preserves_partial_run(self):
        out=self.root/'r'
        with patch.object(Provider,'generate',side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):run_benchmark(MOCK,out,suite='smoke',quiet=True)
        m,rows,_=load_run(out);self.assertEqual(m['status'],'interrupted');self.assertEqual(rows,[]);self.assertTrue((out/'report.html').exists())
    def test_real_protocol_connection_end_to_end(self):
        with FakeAPI() as api:
            s=run_benchmark(api.config(stream_usage=True,send_seed=True),self.root/'r',suite='smoke',quiet=True)
            self.assertEqual(s['successful_generations'],22);self.assertEqual(s['reported_usage']['known_full_usage_responses'],22)
            self.assertEqual(s['ttft_seconds']['observations'],22)

class JudgingAndComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)
        run_benchmark(MOCK,cls.root/'a',suite='smoke',quiet=True)
        run_benchmark(BROKEN,cls.root/'b',suite='smoke',quiet=True)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def setUp(self):self.extra=tempfile.TemporaryDirectory();self.out=Path(self.extra.name)
    def tearDown(self):self.extra.cleanup()
    def test_complete_trajectory_is_one_judge_unit(self):
        _,rows,data=load_run(self.root/'a');targets=natural_targets(rows,data)
        self.assertEqual(len(targets),7);self.assertEqual(sum(t['mode']=='dialogue' for t in targets),1)
    def test_invalid_evidence_rejected(self):
        target={'dimensions':['persona'],'candidate_text':'こんにちは。'}
        text=dumps({'scores':{'persona':{'score':5,'evidence':'存在しない引用','reason':'because'}}})
        with self.assertRaises(ValueError):validate_rubric(text,target)
    def test_missing_dimension_rejected(self):
        with self.assertRaises(ValueError):validate_rubric('{"scores":{}}',{'dimensions':['persona'],'candidate_text':'x'})
    def test_null_for_unobserved_dimension_allowed(self):
        target={'dimensions':['persona'],'candidate_text':'x'}
        text=dumps({'scores':{'persona':{'score':None,'evidence':'','reason':'not elicited'}}})
        self.assertIsNone(validate_rubric(text,target)['persona']['score'])
    def test_judge_boolean_score_rejected(self):
        target={'dimensions':['persona'],'candidate_text':'x'}
        text=dumps({'scores':{'persona':{'score':True,'evidence':'x','reason':'x'}}})
        with self.assertRaises(ValueError):validate_rubric(text,target)
    def test_malformed_pair_label_rejected(self):
        with self.assertRaises(ValueError):validate_pair('{"winner":"C","reason":"x"}')
    def test_paired_diagnostic_difference(self):
        result=compare_runs(self.root/'a',self.root/'b',self.out/'compare')
        self.assertEqual(result['paired_diagnostic_A_minus_B']['mean'],1)
    def test_core_system_mixing_rejected(self):
        system=validate_config({'provider':'mock','model':'fixture','track':'system','runtime_id':'test-runtime'})
        run_benchmark(system,self.out/'sys',suite='smoke',quiet=True)
        with self.assertRaises(KCBError):compare_runs(self.root/'a',self.out/'sys',self.out/'cmp')
    def test_order_sensitive_is_not_a_tie(self):
        with FakeAPI(text='{"winner":"A","reason":"always chooses left"}') as api:
            result=pairwise_judge(self.root/'a',self.root/'b',api.config(),self.out/'pair',limit=1,quiet=True)
            self.assertEqual(result['status_counts'],{'order_sensitive':1});self.assertEqual(result['stable_counts'],{})
            first=json_payload(api.requests[0]);second=json_payload(api.requests[1])
            self.assertEqual(first['A'],second['B']);self.assertEqual(first['B'],second['A'])
    def test_pairwise_mock_two_orders(self):
        result=pairwise_judge(self.root/'a',self.root/'b',MOCK,self.out/'pair',quiet=True)
        self.assertEqual(result['records'],7);self.assertEqual(result['stable_counts'].get('A'),7)
    def test_pairwise_resume_does_not_rejudge(self):
        pairwise_judge(self.root/'a',self.root/'b',MOCK,self.out/'pair',quiet=True)
        with patch.object(Provider,'generate',side_effect=AssertionError('no new calls')):
            pairwise_judge(self.root/'a',self.root/'b',MOCK,self.out/'pair',resume=True,quiet=True)
    def test_snapshot_hash_changes_when_answer_changes(self):
        _,rows,_=load_run(self.root/'a');changed=copy.deepcopy(rows);changed[0]['text']+='changed'
        self.assertNotEqual(response_snapshot_hash(rows),response_snapshot_hash(changed))
    def test_rubric_judging_and_report(self):
        run_benchmark(MOCK,self.out/'a',suite='smoke',quiet=True)
        result=rubric_judge(self.out/'a',MOCK,quiet=True)
        summary=load_json(self.out/'a/summary.json')
        self.assertEqual(result['ok'],7);self.assertEqual(summary['semantic_state'],'self_judged_uncalibrated')
        self.assertEqual(summary['self_judge_ids'],[result['judge_id']])
    def test_partial_judge_coverage_remains_explicit(self):
        run_benchmark(MOCK,self.out/'a',suite='smoke',quiet=True)
        rubric_judge(self.out/'a',MOCK,limit=1,quiet=True)
        coverage=load_json(self.out/'a/summary.json')['semantic_coverage']
        self.assertEqual(coverage['planned_natural_targets'],7)
        self.assertEqual(coverage['complete_eligible_targets'],7)
        self.assertEqual(coverage['targets_with_valid_judge_record'],1)
        self.assertEqual(coverage['mock_judge_records'],1)
    def test_invalid_judge_not_converted_to_zero(self):
        run_benchmark(MOCK,self.out/'a',suite='smoke',quiet=True)
        with patch.object(Provider,'generate',return_value=Generation('not JSON',.01,mock=True)):
            result=rubric_judge(self.out/'a',MOCK,limit=1,quiet=True)
        self.assertEqual(result['ok'],0);self.assertEqual(load_json(self.out/'a/summary.json')['semantic_state'],'not_evaluated')

def json_payload(request):
    import json
    return json.loads(request['messages'][-1]['content'])

class SystemBridgeTests(unittest.TestCase):
    def test_session_reset_and_followups(self):
        from tools.system_bridge import make_server
        with tempfile.TemporaryDirectory() as d:
            server=make_server(copy.deepcopy(MOCK),0,str(Path(d)/'bridge.sqlite3'))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                config=validate_config({'provider':'system_http','base_url':f'http://127.0.0.1:{server.server_port}/kcb/v1','model':'auto','track':'system','runtime_id':'reference-test','stream':False})
                s=run_benchmark(config,Path(d)/'run',suite='dialogue',limit_units=1,quiet=True)
                self.assertEqual(s['successful_generations'],12);self.assertEqual(s['track'],'system');self.assertTrue(s['mock'])
            finally:server.shutdown();server.server_close();thread.join(timeout=3)

if __name__=='__main__':unittest.main()
