import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CreatorSettings from '../pages/CreatorSettings';
import StorySettingsEditor from './StorySettingsEditor';
import { CastMemberSchema, RPGOptionsSchema } from '../../../../packages/schemas/src';

const fixture=vi.hoisted(()=>({language:'en',story:true,states:[] as unknown[],next:0,
  updates:[] as {index:number;value:unknown}[],lab:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:vi.fn(),useRef:(value:unknown)=>({current:value}),
  useState:(initial:unknown)=>{const index=fixture.next++;return [fixture.states[index]??(typeof initial==='function'?initial():initial),
    (value:unknown)=>fixture.updates.push({index,value})];}}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language}));
vi.mock('../lib/capabilities',()=>({useCapabilities:()=>({capabilities:{features:{story_rules:fixture.story}}})}));
vi.mock('../lib/title',()=>({useDocumentTitle:vi.fn()}));
vi.mock('../lib/lab',()=>({labRequest:fixture.lab}));
vi.mock('react-router-dom',()=>({Link:({to,children}:any)=><a href={to}>{children}</a>}));
vi.mock('./RuntimeMedia',()=>({RuntimeDownload:({href,children}:any)=><a data-runtime-download={href}>{children}</a>}));
const cast=[CastMemberSchema.parse({id:'fixed-cast',display_name:'原文の人物',knowledge:'本人だけの知識'})];
const rpg=RPGOptionsSchema.parse({initial_hp:42});
const draft={display_name:'編集中の設定',description:'原文の説明',traits:'原文の性格',rules:'原文のルール',cast,rpg};
const item={...draft,id:'created_0123456789abcdef0123456789abcdef@2',revision:2,kind:'world',created_at:'fixture'};
function view(render:()=>ReactNode,states:unknown[]){fixture.next=0;fixture.states=states;return render();}
function settings(kind='world',notice='',valid=true){return view(CreatorSettings,[kind,[item],item,[item,{...item,id:item.id.replace('@2','@1'),revision:1}],draft,'',notice,false,valid,0]);}
function nodes(tree:ReactNode,match:(node:ReactElement<any>)=>boolean):ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node=>!isValidElement<{children?:ReactNode}>(node)?[]:
    [...(match(node)?[node]:[]),...nodes(node.props.children,match)]);
}
beforeEach(()=>{vi.clearAllMocks();fixture.language='en';fixture.story=true;fixture.updates=[];});
afterEach(()=>vi.unstubAllGlobals());

it('retains authored settings, stable versions and explicit-only export/save across languages',()=>{
  for(const language of ['ja','en'])for(const kind of ['persona','world']){
    fixture.language=language;
    const html=renderToStaticMarkup(settings(kind,'saved'));
    expect(html).toContain(draft.display_name);expect(html).toContain(draft.description);
    expect(html).toContain(kind==='persona'?draft.traits:draft.rules);
    expect(html).toContain(`/api/creator/${kind}/${item.id}/export`);
    expect(html).toContain(`/api/creator/${kind}/${item.id.replace('@2','@1')}/export`);
    expect(html).toContain(language==='en'?'Existing conversations keep their selected version.':'既存の会話は選択済みの版を使います。');
    expect(fixture.lab).not.toHaveBeenCalled();
  }
});

it('sends the same original settings only on explicit version save in either language',async()=>{
  fixture.lab.mockImplementation(async(path:string,init?:RequestInit)=>init?.method?item:
    path.endsWith(item.id)?{versions:[item]}:{items:[item]});
  for(const language of ['ja','en']){
    fixture.language=language;
    const tree=settings();expect(fixture.lab).not.toHaveBeenCalled();
    nodes(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
    await vi.waitFor(()=>expect(fixture.lab).toHaveBeenCalledTimes(3));
    expect(fixture.lab).toHaveBeenNthCalledWith(1,`creator/world/${item.id}`,{method:'PUT',body:JSON.stringify(draft)});
    expect(fixture.updates).toContainEqual({index:6,value:'saved'});
    fixture.lab.mockClear();
  }
});

it('keeps invalid RPG text and saved rules intact through language changes and capability denial',()=>{
  const invalid='{ "initial_hp":';
  const change=vi.fn(),validity=vi.fn();
  for(const language of ['ja','en']){
    fixture.language=language;fixture.story=false;
    const tree=view(()=>StorySettingsEditor({cast,rpg,onChange:change,onValidity:validity,disabled:false}),[invalid,'HP・技能・行動の形式を確認してください。修正するまで保存できません。']);
    const html=renderToStaticMarkup(tree);
    expect(html).toContain(language==='en'?'Saved settings are retained.':'保存された設定は保持しています。');
    expect(html).toContain(language==='en'?'Saving is blocked':'修正するまで保存できません');
    const text=nodes(tree,node=>node.props['aria-describedby']==='rpg-rule-help')[0];
    expect(text.props.value).toBe(invalid);expect(text.props['aria-invalid']).toBe(true);
    expect(nodes(tree,node=>node.type==='fieldset')[0].props.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
  }
});

it('rejects invalid RPG edits without committing them and keeps cast IDs on valid edits',()=>{
  const change=vi.fn();
  const tree=view(()=>StorySettingsEditor({cast,rpg,onChange:change,onValidity:vi.fn(),disabled:false}),[JSON.stringify(rpg),'']);
  const text=nodes(tree,node=>node.props['aria-describedby']==='rpg-rule-help')[0];
  text.props.onChange({target:{value:'{"initial_hp":'}});
  expect(change).not.toHaveBeenCalled();
  expect(fixture.updates).toContainEqual({index:0,value:'{"initial_hp":'});
  text.props.onChange({target:{value:JSON.stringify({...rpg,initial_hp:55})}});
  expect(change).toHaveBeenCalledWith(cast,{...rpg,initial_hp:55});
  expect(cast[0].id).toBe('fixed-cast');
});

it('keeps unique-cast validation and world saving blocked in both display languages',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const tree=view(()=>StorySettingsEditor({cast:[cast[0],cast[0]],rpg,onChange:vi.fn(),onValidity:vi.fn(),disabled:false}),[]);
    const html=renderToStaticMarkup(tree);
    expect(html).toContain(language==='en'?'unique IDs':'人物名・ID・人数');
    const save=nodes(settings('world','',false),node=>node.props.type==='submit')[0];
    expect(save.props.disabled).toBe(true);
  }
});

it('checks creator-import size before reading and does not auto-save imported files',async()=>{
  const tree=settings(),read=vi.fn();
  nodes(tree,node=>node.type==='input'&&node.props.type==='file')[0].props.onChange({target:{files:[{size:100001,text:read}],value:'fixture.json'}});
  await vi.waitFor(()=>expect(fixture.updates).toContainEqual({index:5,value:'100KB以下の設定ファイルを選んでください。'}));
  expect(read).not.toHaveBeenCalled();expect(fixture.lab).not.toHaveBeenCalled();
});
