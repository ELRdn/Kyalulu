from __future__ import annotations
import argparse
import copy
import os
import subprocess
import sys
import webbrowser
import uuid
from datetime import datetime
from pathlib import Path
from . import __version__
from .config import check_network, load_config, validate_config
from .dataset import load_dataset, overview, select_units
from .providers import Provider
from .util import ROOT, KCBError, dumps, save_json


def config_args(parser):
    parser.add_argument('--config',default=str(ROOT/'configs/lmstudio.json'))
    parser.add_argument('--model',help='Exact server model ID; overrides config')
    parser.add_argument('--allow-remote',action='store_true',help='Explicitly allow non-loopback network requests (including LAN/API)')


def get_config(args):
    config=load_config(args.config)
    if getattr(args,'model',None):
        config['model']=args.model
    if getattr(args,'label',None):
        config['label']=args.label
    return validate_config(config)


def make_parser():
    p=argparse.ArgumentParser(prog='kcb',description='Kyalulu CharacterBench v0.1 — local, auditable Japanese character evaluation')
    p.add_argument('--version',action='version',version=__version__)
    sub=p.add_subparsers(dest='command')
    v=sub.add_parser('validate',help='Validate the bundled/custom dataset')
    v.add_argument('--dataset',default=None)
    pl=sub.add_parser('plan',help='Show generation/judgment counts without making API calls')
    pl.add_argument('--dataset',default=None);pl.add_argument('--suite',default='all',choices=['all','smoke','single','dialogue','diagnostic','natural']);pl.add_argument('--repeats',type=int,default=1)
    for name in ('doctor','models'):
        item=sub.add_parser(name,help='Check endpoint/discover server model IDs')
        config_args(item)
        if name=='doctor': item.add_argument('--probe',action='store_true',help='Make ONE unscored generation; may incur fees')
    r=sub.add_parser('run',help='Generate, automatically grade mechanics, and build an HTML report')
    config_args(r);r.add_argument('--label');r.add_argument('--out',required=True);r.add_argument('--dataset',default=None)
    r.add_argument('--suite',default='all',choices=['all','smoke','single','dialogue','diagnostic','natural'])
    r.add_argument('--repeats',type=int,default=1);r.add_argument('--seed',type=int,default=17);r.add_argument('--workers',type=int,default=1)
    r.add_argument('--warmup',type=int,default=0);r.add_argument('--limit-units',type=int);r.add_argument('--resume',action='store_true');r.add_argument('--retry-errors',action='store_true');r.add_argument('--retry-workers',type=int,help='Failure-only retry concurrency; recorded separately from original run workers');r.add_argument('--quiet',action='store_true')
    d=sub.add_parser('demo',help='Run scripted MOCK fixtures end-to-end, completely offline')
    d.add_argument('--out',default='runs/demo');d.add_argument('--suite',choices=['all','smoke'],default='all');d.add_argument('--open',action='store_true')
    rep=sub.add_parser('report',help='Regenerate the offline HTML/JSON/CSV report')
    rep.add_argument('--run',required=True);rep.add_argument('--open',action='store_true')
    reg=sub.add_parser('regrade',help='Explicitly regrade saved responses with current checker; archive old evaluations')
    reg.add_argument('--run',required=True)
    j=sub.add_parser('judge',help='Rubric-grade natural replies/complete trajectories using a separate LLM')
    j.add_argument('--run',required=True);j.add_argument('--config',required=True,action='append',help='May be supplied twice for two judge configurations')
    j.add_argument('--limit',type=int);j.add_argument('--resume',action='store_true');j.add_argument('--allow-remote',action='store_true');j.add_argument('--quiet',action='store_true')
    for name in ('compare','pairwise','human-export'):
        item=sub.add_parser(name,help={'compare':'Paired state diagnostics, without conflating them with character quality','pairwise':'Natural A/B preference with both display orders','human-export':'Export a standalone offline blind human-review HTML'}[name])
        item.add_argument('--a',required=True);item.add_argument('--b',required=True);item.add_argument('--out',required=True);item.add_argument('--allow-partial',action='store_true')
        if name!='compare': item.add_argument('--limit',type=int)
        if name=='pairwise':
            config_args(item);item.add_argument('--resume',action='store_true');item.add_argument('--quiet',action='store_true')
    hi=sub.add_parser('human-import',help='Validate/deduplicate anonymous votes and recover blinded labels')
    hi.add_argument('--key',required=True);hi.add_argument('--votes',required=True,nargs='+');hi.add_argument('--out',required=True)
    ca=sub.add_parser('calibrate',help='Measure observed judge/human agreement; not a validity certificate')
    ca.add_argument('--pairwise',required=True);ca.add_argument('--human',required=True);ca.add_argument('--out',required=True)
    sub.add_parser('selftest',help='Run the bundled unittest suite; no real model or API key required')
    sub.add_parser('launch',help='Interactive local launcher')
    return p


def demo(out,suite='all',open_browser=False):
    from .runner import run_benchmark
    from .judging import rubric_judge
    from .comparison import compare_runs,pairwise_judge
    from .human import export_human
    out=Path(out)
    if out.exists() and any(out.iterdir()):
        raise KCBError('Demo output exists. Choose a NEW --out folder; existing results are never silently overwritten.')
    config=validate_config({'provider':'mock','model':'fixture','label':'MOCK scripted fixture'})
    broken=validate_config({'provider':'mock','model':'broken','label':'MOCK deliberately broken fixture'})
    run_benchmark(config,out/'fixture',suite=suite,quiet=True)
    run_benchmark(broken,out/'broken',suite=suite,quiet=True)
    rubric_judge(out/'fixture',config,quiet=True)
    compare_runs(out/'fixture',out/'broken',out/'comparison')
    pairwise_judge(out/'fixture',out/'broken',config,out/'pairwise',quiet=True)
    export_human(out/'fixture',out/'broken',out/'human')
    from .report import CSS
    (out/'INDEX.html').write_text('''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KCB demo</title><style>'''+CSS+'''</style><main><div class="eyebrow">KCB / OFFLINE ENGINEERING DEMO</div><h1>実行から比較まで、ひとつの流れに。</h1><div class="notice mock">すべてMOCK固定応答です。実LLMの性能・速度・順位ではありません。人間による採点もまだありません。</div><div class="section"><p><a href="fixture/report.html">固定応答 fixture のレポート</a></p><p><a href="broken/report.html">意図的な失敗 fixture のレポート</a></p><p><a href="comparison/comparison.html">状態診断の対応比較</a></p><p><a href="pairwise/report.html">順序反転付きA/B（MOCK judge）</a></p><p><a href="human/blind-arena.html">人間によるブラインド評価画面（未採点）</a></p></div><p>本当のモデルを評価するには、LM StudioなどでLLMサーバーを起動し、README_JA.md の run コマンドを使ってください。</p></main></html>''',encoding='utf-8')
    if open_browser: webbrowser.open((out/'INDEX.html').resolve().as_uri())
    return {'demo_only':True,'index':str(out/'INDEX.html'),'suite':suite}


def launch():
    print('\nKyalulu CharacterBench 0.1\n1: Offline demo\n2: Run a local model\n3: Endpoint check\n0: Exit')
    choice=input('Select [1]: ').strip() or '1'
    if choice=='0': return 0
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S')
    if choice=='1':
        print(dumps(demo(ROOT/'runs'/f'demo-{stamp}','all',True),pretty=True));return 0
    config_path=input('Config [configs/lmstudio.json]: ').strip() or str(ROOT/'configs/lmstudio.json')
    config=load_config(config_path)
    check_network(config,False)
    client=Provider(config);models=client.models()
    for i,name in enumerate(models,1): print(f'{i}: {name}')
    if choice=='3': return 0
    if not models: raise KCBError('No models returned. Load a chat model in your LLM server.')
    if len(models)==1: config['model']=models[0]
    else:
        selected=int(input('Select model number: '))
        if not 1<=selected<=len(models): raise KCBError('Invalid model selection')
        config['model']=models[selected-1]
    suite=input('Suite smoke=22 / all=264 [smoke]: ').strip() or 'smoke'
    if suite not in ('smoke','all'): raise KCBError('Choose smoke or all')
    out=ROOT/'runs'/f'local-{stamp}'
    from .runner import run_benchmark
    run_benchmark(config,out,suite=suite)
    webbrowser.open((out/'report.html').resolve().as_uri())
    return 0


def main(argv=None):
    if sys.version_info<(3,10):
        print('Python 3.10 or newer is required.',file=sys.stderr);return 2
    parser=make_parser();args=parser.parse_args(argv)
    try:
        if not args.command: parser.print_help();return 0
        if args.command=='launch': return launch()
        if args.command=='selftest':
            return subprocess.call([sys.executable,'-m','unittest','discover','-s','tests','-v'],cwd=ROOT)
        if args.command=='validate': result=overview(load_dataset(args.dataset))
        elif args.command=='plan':
            if args.repeats<1: raise KCBError('repeats must be positive')
            data=load_dataset(args.dataset);units=select_units(data,args.suite)
            natural=sum(u['mode']!='diagnostic' for u in units)*args.repeats
            result={'suite':args.suite,'repeats':args.repeats,'scored_generations':sum(len(u['turns']) for u in units)*args.repeats,
                    'rubric_calls_per_judge_max':natural,'pairwise_calls_per_judge_max_for_two_runs':natural*2,
                    'warmup_and_explicit_retries_extra':True,'network_calls_made':0}
        elif args.command in ('doctor','models'):
            config=get_config(args);check_network(config,args.allow_remote);client=Provider(config);models=client.models()
            result={'base_url':config['base_url'],'model_ids':models,'configured_model':config['model'],
                    'python':sys.version.split()[0],'api_key_env':config['api_key_env'],
                    'api_key_present':bool(os.environ.get(config['api_key_env'])),'provider':config['provider']}
            if getattr(args,'probe',False):
                client.resolve_model()
                ctx={'session_id':'probe:'+uuid.uuid4().hex,'reset':True,'turn_index':1,'character':{}}
                response=client.generate([{'role':'user','content':'接続確認です。短く挨拶してください。'}], session_context=ctx)
                result['unscored_probe']=response.record()
        elif args.command=='run':
            from .runner import run_benchmark
            result=run_benchmark(get_config(args),args.out,dataset_dir=args.dataset,suite=args.suite,repeats=args.repeats,
                                 seed=args.seed,workers=args.workers,warmup=args.warmup,limit_units=args.limit_units,
                                 resume=args.resume,retry_errors=args.retry_errors,retry_workers=args.retry_workers,
                                 allow_remote=args.allow_remote,quiet=args.quiet)
        elif args.command=='demo': result=demo(args.out,args.suite,args.open)
        elif args.command=='report':
            from .report import build_report
            result=build_report(args.run)
            if args.open: webbrowser.open((Path(args.run)/'report.html').resolve().as_uri())
        elif args.command=='regrade':
            from .runner import regrade_run
            result=regrade_run(args.run)
        elif args.command=='judge':
            from .judging import rubric_judge
            result=[rubric_judge(args.run,load_config(path),limit=args.limit,resume=args.resume,allow_remote=args.allow_remote,quiet=args.quiet) for path in args.config]
        elif args.command=='compare':
            from .comparison import compare_runs
            result=compare_runs(args.a,args.b,args.out,allow_partial=args.allow_partial)
        elif args.command=='pairwise':
            from .comparison import pairwise_judge
            result=pairwise_judge(args.a,args.b,get_config(args),args.out,limit=args.limit,resume=args.resume,allow_remote=args.allow_remote,allow_partial=args.allow_partial,quiet=args.quiet)
        elif args.command=='human-export':
            from .human import export_human
            result=export_human(args.a,args.b,args.out,limit=args.limit,allow_partial=args.allow_partial)
        elif args.command=='human-import':
            from .human import import_human
            result=import_human(args.key,args.votes,args.out)
        elif args.command=='calibrate':
            from .human import calibrate
            result=calibrate(args.pairwise,args.human,args.out)
        else: raise KCBError('Unknown command')
        print(dumps(result,pretty=True))
        if args.command == "run" and result.get("status") == "complete_with_errors":
            return 3
        return 0
    except KeyboardInterrupt:
        print('\nInterrupted. Saved generations remain available for --resume.',file=sys.stderr);return 130
    except (KCBError,OSError,ValueError) as exc:
        print(f'KCB ERROR: {exc}',file=sys.stderr);return 2

if __name__=='__main__':
    raise SystemExit(main())
