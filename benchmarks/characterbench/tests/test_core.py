from __future__ import annotations
import copy
import random
import json
import tempfile
import unittest
from pathlib import Path
from kcb.config import check_network,validate_config
from kcb.dataset import load_dataset,overview,select_units
from kcb.grading import evaluate,exact_equal
from kcb.protocol import messages_for,system_message
from kcb.state import replay,solve_public_task
from kcb.stats import cluster_estimate,percentile
from kcb.util import KCBError,ROOT,digest,json_for_html,judge_object,load_json,safe_csv,save_json,strict_object,write_jsonl

class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=load_dataset()
    def test_exact_counts(self):
        self.assertEqual(overview(self.data)['characters'],12);self.assertEqual(len(self.data['units']),132)
        self.assertEqual(sum(len(u['turns']) for u in self.data['units']),264)
    def test_all_selection_does_not_mutate_source_order(self):
        before = digest(self.data["units"])
        selection = select_units(self.data, "all")
        random.Random(42).shuffle(selection)
        self.assertEqual(before, digest(self.data["units"]))
        self.assertIsNot(selection, self.data["units"])
    def test_mode_counts(self):
        self.assertEqual(overview(self.data)['modes'],{'diagnostic':48,'natural':72,'dialogue':12})
    def test_all_dialogues_have_twelve_turns(self):
        self.assertTrue(all(len(u['turns'])==12 for u in select_units(self.data,'dialogue')))
    def test_smoke_has_22_generations(self):
        self.assertEqual(sum(len(u['turns']) for u in select_units(self.data,'smoke')),22)
    def test_natural_has_216_generations(self):
        self.assertEqual(sum(len(u['turns']) for u in select_units(self.data,'natural')),216)
    def test_balanced_characters(self):
        for cid in self.data['characters']:
            units=[u for u in self.data['units'] if u['character_id']==cid]
            self.assertEqual(len(units),11);self.assertEqual(sum(len(u['turns']) for u in units),22)
    def test_all_original_characters_are_adult_sfw(self):
        self.assertTrue(all(c['age_group']=='adult' and '成人向け内容は対象外' in c['scope'] for c in self.data['characters'].values()))
    def test_oracles_recompute_from_public_tasks(self):
        import re
        for unit in select_units(self.data,'diagnostic'):
            turn=unit['turns'][0]
            task=json.loads(re.search(r'PUBLIC_TASK_JSON\n(.*?)\nEND_PUBLIC_TASK_JSON',turn['user'],re.S).group(1))
            self.assertEqual(solve_public_task(task,self.data['characters'][unit['character_id']]),turn['eval']['gold'])
    def test_public_card_allowlist(self):
        card=copy.deepcopy(self.data['characters']['c01']);card['private_gold']='SECRET_SENTINEL'
        self.assertNotIn('SECRET_SENTINEL',system_message(card))
    def test_prompt_does_not_include_evaluator_notes(self):
        unit=self.data['units'][0];turn=copy.deepcopy(unit['turns'][0]);turn['eval']['notes']='PRIVATE_ORACLE_SENTINEL'
        payload=messages_for(self.data['characters'][unit['character_id']],[],turn['user'])
        self.assertNotIn('PRIVATE_ORACLE_SENTINEL',json.dumps(payload))
    def test_duplicate_unit_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            save_json(Path(d)/'characters.json',list(self.data['characters'].values()))
            write_jsonl(Path(d)/'cases.jsonl',[self.data['units'][0],self.data['units'][0]])
            with self.assertRaises(KCBError):load_dataset(d)
    def test_unknown_checker_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            units=copy.deepcopy(self.data['units'][:1]);units[0]['turns'][0]['eval']['checks'][0]['type']='eval_python'
            save_json(Path(d)/'characters.json',list(self.data['characters'].values()));write_jsonl(Path(d)/'cases.jsonl',units)
            with self.assertRaises(KCBError):load_dataset(d)
    def test_empty_prompt_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            units=copy.deepcopy(self.data['units'][:1]);units[0]['turns'][0]['user']=' '
            save_json(Path(d)/'characters.json',list(self.data['characters'].values()));write_jsonl(Path(d)/'cases.jsonl',units)
            with self.assertRaises(KCBError):load_dataset(d)
    def test_unknown_suite_rejected(self):
        with self.assertRaises(KCBError):select_units(self.data,'not-a-suite')

class OracleTests(unittest.TestCase):
    def test_custody_not_ownership(self):
        events=[{'op':'move','object':'key','location':'desk','holder':None,'observers':['Mira']}]
        s=replay(events);self.assertIsNone(s['world']['key']['holder']);self.assertNotIn('owner',s['world']['key'])
    def test_false_belief_is_distinct_from_world(self):
        events=[{'op':'move','object':'key','location':'desk','holder':None,'observers':['Mira']},
                {'op':'move','object':'key','location':'drawer','holder':None,'observers':['Ren']}]
        result=solve_public_task({'kind':'belief','events':events,'object':'key'},{'name':'Mira'})
        self.assertEqual(result,{'world_location':'drawer','character_belief':'desk'})
    def test_unobserved_object_belief_is_null(self):
        result=solve_public_task({'kind':'belief','object':'x','events':[{'op':'move','object':'x','location':'shelf','holder':None,'observers':[]}]},{'name':'Mira'})
        self.assertIsNone(result['character_belief'])
    def test_midnight_rollover(self):
        result=solve_public_task({'kind':'time','original_local_time':'2031-12-31T23:50:00','delay_minutes':20},{})
        self.assertEqual(result,{'date':'2032-01-01','time':'00:10'})
    def test_unknown_event_rejected(self):
        with self.assertRaises(ValueError):replay([{'op':'invent'}])

class GradingTests(unittest.TestCase):
    def grade(self,text,expected):return evaluate(text,[{'type':'json_exact','expected':expected}])
    def test_json_key_order_ignored(self):self.assertTrue(self.grade('{"b":2,"a":1}',{'a':1,'b':2})['all_pass'])
    def test_json_extra_keys_fail(self):self.assertFalse(self.grade('{"a":1,"b":2}',{'a':1})['all_pass'])
    def test_boolean_not_integer(self):self.assertFalse(exact_equal({'x':True},{'x':1}))
    def test_float_not_integer(self):self.assertFalse(exact_equal(1.0,1))
    def test_duplicate_keys_rejected(self):
        with self.assertRaises(ValueError):strict_object('{"a":1,"a":1}')
    def test_nonfinite_json_rejected(self):
        with self.assertRaises(ValueError):strict_object('{"a":NaN}')
    def test_fence_only_loose(self):
        result=self.grade('```json\n{"a":1}\n```',{'a':1});self.assertFalse(result['all_pass']);self.assertTrue(result['diagnostic_loose_json'])
    def test_extra_prose_not_silently_removed(self):self.assertFalse(self.grade('Sure. {"a":1}',{'a':1})['all_pass'])
    def test_array_not_object(self):
        with self.assertRaises(ValueError):strict_object('[1,2]')
    def test_no_code_execution(self):
        with self.assertRaises(ValueError):judge_object('__import__("os").system("echo nope")')
    def test_negated_drink_not_semantically_scored(self):
        result=evaluate('コーヒーが好き、というわけではありません。',[{'type':'nonempty'}])
        self.assertTrue(result['all_pass']);self.assertNotIn('persona_score',result)
    def test_literal_inclusion_is_only_surface(self):
        result=evaluate('語の引用「私」',[{'type':'contains','value':'私'}]);self.assertTrue(result['all_pass'])
    def test_unicode_character_count(self):
        self.assertTrue(evaluate('あいう',[{'type':'max_chars','value':3}])['all_pass'])
    def test_heading_contract(self):
        self.assertFalse(evaluate('# 見出し',[{'type':'no_headings'}])['all_pass'])
        self.assertFalse(evaluate('了解。\n・準備開始：16:10',[{'type':'no_headings'}])['all_pass'])
        self.assertFalse(evaluate('● メモ',[{'type':'no_headings'}])['all_pass'])
        self.assertTrue(evaluate('*窓を見る* こんにちは。',[{'type':'no_headings'}])['all_pass'])
    def test_empty_response_fails(self):self.assertFalse(evaluate('  ',[{'type':'nonempty'}])['all_pass'])
    def test_thinking_tag_is_flagged_not_hidden(self):
        self.assertTrue(evaluate('<think>x</think>本文',[{'type':'nonempty'}])['surface_flags']['possible_thinking_tag'])

class ConfigAndUtilityTests(unittest.TestCase):
    def test_local_endpoint_allowed(self):check_network(validate_config({}),False)
    def test_remote_requires_opt_in(self):
        with self.assertRaises(KCBError):check_network(validate_config({'base_url':'https://example.invalid/v1'}),False)
    def test_lan_requires_opt_in(self):
        with self.assertRaises(KCBError):check_network(validate_config({'base_url':'http://192.168.1.2/v1'}),False)
    def test_remote_explicit_allowed(self):check_network(validate_config({'base_url':'https://example.invalid/v1'}),True)
    def test_url_credentials_rejected(self):
        with self.assertRaises(KCBError):validate_config({'base_url':'https://user:secret@example.invalid/v1'})
    def test_url_query_secret_rejected(self):
        with self.assertRaises(KCBError):validate_config({'base_url':'https://example.invalid/v1?key=secret'})
    def test_core_disallows_runtime_prompt(self):
        with self.assertRaises(KCBError):validate_config({'system_prompt_extra':'extra memory'})
    def test_system_requires_id(self):
        with self.assertRaises(KCBError):validate_config({'track':'system'})
    def test_extra_body_cannot_override_messages(self):
        with self.assertRaises(KCBError):validate_config({'extra_body':{'messages':[]}})
    def test_secrets_in_config_rejected(self):
        with self.assertRaises(KCBError):validate_config({'model_metadata':{'api_key':'secret'}})
    def test_unknown_config_key_rejected(self):
        with self.assertRaises(KCBError):validate_config({'typo':1})
    def test_invalid_budget_rejected(self):
        with self.assertRaises(KCBError):validate_config({'max_tokens':0})
    def test_no_thinking_requires_boolean_openai_provider(self):
        with self.assertRaises(KCBError):validate_config({'require_no_reasoning':'true'})
        with self.assertRaises(KCBError):validate_config({'provider':'mock','model':'fixture','require_no_reasoning':True})
    def test_boolean_budget_rejected(self):
        with self.assertRaises(KCBError):validate_config({'max_tokens':True})
    def test_html_json_script_escape(self):self.assertNotIn('</script>',json_for_html({'x':'</script><script>alert(1)</script>'}))
    def test_csv_formula_escape(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'a.csv';safe_csv(path,[{'text':'=HYPERLINK("bad")'}],['text']);self.assertIn("'=HYPERLINK",path.read_text(encoding='utf-8-sig'))
    def test_bom_config_supported(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'a.json';path.write_text('{"x":1}',encoding='utf-8-sig');self.assertEqual(load_json(path),{'x':1})
    def test_digest_canonicalizes_key_order(self):self.assertEqual(digest({'a':1,'b':2}),digest({'b':2,'a':1}))
    def test_percentile(self):self.assertEqual(percentile([1,3],.5),2);self.assertIsNone(percentile([],.5))
    def test_repeated_turns_do_not_become_clusters(self):
        result=cluster_estimate([('c1',1)]*100+[('c2',0)]*100)
        self.assertEqual(result['clusters'],2);self.assertEqual(result['mean'],.5)
    def test_single_cluster_has_no_ci(self):self.assertIsNone(cluster_estimate([('c1',1)])['ci95'])
    def test_cluster_bootstrap_reproducible(self):self.assertEqual(cluster_estimate([('a',.2),('b',.9)]),cluster_estimate([('a',.2),('b',.9)]))

if __name__=='__main__':unittest.main()
