from __future__ import annotations
import tempfile
import unittest
from pathlib import Path
from kcb.config import validate_config
from kcb.runner import run_benchmark
from kcb.comparison import pairwise_judge
from kcb.human import export_human,import_human,calibrate
from kcb.util import KCBError,load_json,save_json

class HumanReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)
        cls.config=validate_config({'provider':'mock','model':'fixture','label':'SECRET_MODEL_LABEL_A'})
        run_benchmark(cls.config,cls.root/'a',suite='smoke',quiet=True)
        run_benchmark(validate_config({'provider':'mock','model':'broken','label':'SECRET_MODEL_LABEL_B'}),cls.root/'b',suite='smoke',quiet=True)
        export_human(cls.root/'a',cls.root/'b',cls.root/'study')
        cls.keypath=cls.root/'study/PRIVATE_KEY_DO_NOT_SHARE_WITH_RATERS.json';cls.key=load_json(cls.keypath)
        pairwise_judge(cls.root/'a',cls.root/'b',cls.config,cls.root/'pair',quiet=True)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.out=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def batch(self,vote=None):
        item=self.key['items'][0]
        # Default vote selects original candidate A regardless of display order.
        choice=vote or ('A' if item['display_A_is']=='A' else 'B')
        return {'schema':'kcb-human-v0.1','study_id':self.key['study_id'],'rater_id':'synthetic-test-rater',
                'annotations':[{'sample_id':item['sample_id'],'vote':choice}]}
    def test_html_and_blind_data_do_not_reveal_model_labels(self):
        text=(self.root/'study/blind-arena.html').read_text()
        self.assertNotIn('SECRET_MODEL_LABEL_A',text);self.assertNotIn('SECRET_MODEL_LABEL_B',text)
        self.assertNotIn('run_snapshots',text)
    def test_all_natural_units_exported(self):self.assertEqual(len(self.key['items']),7)
    def test_blind_mapping_recovered(self):
        path=self.out/'votes.json';save_json(path,self.batch());s=import_human(self.keypath,[path],self.out/'result')
        self.assertEqual(s['vote_counts'],{'A':1});self.assertEqual(s['rater_count'],1)
    def test_wrong_study_rejected(self):
        batch=self.batch();batch['study_id']='wrong';path=self.out/'votes.json';save_json(path,batch)
        with self.assertRaises(KCBError):import_human(self.keypath,[path],self.out/'result')
    def test_unknown_sample_rejected(self):
        batch=self.batch();batch['annotations'][0]['sample_id']='unknown';path=self.out/'votes.json';save_json(path,batch)
        with self.assertRaises(KCBError):import_human(self.keypath,[path],self.out/'result')
    def test_invalid_vote_rejected(self):
        path=self.out/'votes.json';save_json(path,self.batch('not-a-vote'))
        with self.assertRaises(KCBError):import_human(self.keypath,[path],self.out/'result')
    def test_duplicate_in_same_file_rejected(self):
        batch=self.batch();batch['annotations']*=2;path=self.out/'votes.json';save_json(path,batch)
        with self.assertRaises(KCBError):import_human(self.keypath,[path],self.out/'result')
    def test_same_file_twice_is_deduplicated(self):
        path=self.out/'votes.json';save_json(path,self.batch());s=import_human(self.keypath,[path,path],self.out/'result')
        self.assertEqual(s['votes'],1)
    def test_conflicting_votes_rejected(self):
        a=self.out/'a.json';b=self.out/'b.json';save_json(a,self.batch('A'));save_json(b,self.batch('B'))
        with self.assertRaises(KCBError):import_human(self.keypath,[a,b],self.out/'result')
    def test_both_bad_and_skip_are_explicit(self):
        path=self.out/'votes.json';save_json(path,self.batch('both_bad'));s=import_human(self.keypath,[path],self.out/'result')
        self.assertEqual(s['vote_counts'],{'both_bad':1});self.assertEqual(s['A_preference_score']['mean'],.5)
    def test_skip_not_counted_as_preference(self):
        path=self.out/'votes.json';save_json(path,self.batch('skip'));s=import_human(self.keypath,[path],self.out/'result')
        self.assertIsNone(s['A_preference_score']['mean']);self.assertEqual(s['target_count'],0)
    def test_observed_agreement_pipeline(self):
        path=self.out/'votes.json';save_json(path,self.batch());import_human(self.keypath,[path],self.out/'human')
        s=calibrate(self.root/'pair',self.out/'human',self.out/'calibration')
        self.assertEqual(s['matched_votes'],1);self.assertEqual(s['exact_categorical_agreement'],1)
    def test_export_refuses_overwrite(self):
        with self.assertRaises(KCBError):export_human(self.root/'a',self.root/'b',self.root/'study')

if __name__=='__main__':unittest.main()
