import type { Character, Conversation, MobileData, ModelStatus } from './types';
import { DEFAULT_MODEL } from './types';

const DB = 'kyalulu-mobile-v1';
function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{req.result.createObjectStore('data');req.result.createObjectStore('models',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(new Error('端末への保存を開けません。ブラウザの保存設定を確認してください。'));
  });
}
async function request<T>(name: string, mode: IDBTransactionMode, run: (s: IDBObjectStore)=>IDBRequest<T>): Promise<T> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(name,mode); const req=run(tx.objectStore(name));
    tx.oncomplete=()=>{db.close();resolve(req.result);};
    tx.onabort=tx.onerror=()=>{db.close();reject(new Error('端末への保存に失敗しました。空き容量を確認してください。'));};
  });
}
export const initialData = (): MobileData => ({version:1,selectedModel:DEFAULT_MODEL,characters:[{
  id:'kyalulu',name:'キャルル',prompt:'あなたはキャルル。親しみやすい女の子として、日本語でユーザーとの会話を楽しんでください。相手の直前の言葉に応え、自分の気持ちや動作を自然に表現してください。',intro:'こんにちは！ 今日はどんな話をしようか？',
}],conversations:[]});
export async function loadData(): Promise<MobileData> {return (await request<MobileData|undefined>('data','readonly',s=>s.get('current'))) ?? initialData();}
export const saveData=(data:MobileData)=>request('data','readwrite',s=>s.put(data,'current'));
export const modelStatuses=()=>request<ModelStatus[]>('models','readonly',s=>s.getAll());
export const saveModelStatus=(status:ModelStatus)=>request('models','readwrite',s=>s.put(status));
export const deleteModelStatus=(id:string)=>request('models','readwrite',s=>s.delete(id));

function text(value:unknown,max:number):value is string {return typeof value==='string'&&value.length<=max;}
function character(c:any):c is Character {return c&&text(c.id,100)&&text(c.name,100)&&!!c.name.trim()&&text(c.prompt,32000)&&text(c.intro,16000);}
export function parseBackup(raw:string):MobileData {
  if(raw.length>32*1024*1024) throw Error('バックアップは32MiB以下にしてください。');
  const d=JSON.parse(raw);
  if(!d||d.version!==1||!text(d.selectedModel,100)||!Array.isArray(d.characters)||!d.characters.length||d.characters.length>1000||!d.characters.every(character)||
    !Array.isArray(d.conversations)||d.conversations.length>10000) throw Error('Kyalulu Mobileのバックアップではありません。');
  const ids=new Set(d.characters.map((c:Character)=>c.id));
  if(ids.size!==d.characters.length) throw Error('キャラIDが重複しています。');
  const sessionIds=new Set<string>();
  for(const s of d.conversations) {
    if(!s||!text(s.id,100)||sessionIds.has(s.id)||!text(s.characterId,100)||!character(s.character)||s.character.id!==s.characterId||!text(s.title,200)||!text(s.draft,32000)||!text(s.modelId,100)||
      !text(s.updatedAt,40)||!Number.isFinite(Date.parse(s.updatedAt))||!Array.isArray(s.messages)||s.messages.length>100000) throw Error('会話データが不正です。');
    sessionIds.add(s.id);
    const messageIds=new Set<string>();
    for(const m of s.messages) {
      if(!m||!text(m.id,100)||messageIds.has(m.id)||!['user','assistant'].includes(m.role)||!text(m.content,128000)||
        (m.state!==undefined&&!['complete','stopped','interrupted'].includes(m.state))) throw Error('メッセージが不正です。');
      messageIds.add(m.id);
    }
  }
  return d;
}
export function newConversation(c:Character,modelId:string):Conversation {
  return {id:crypto.randomUUID(),characterId:c.id,character:{...c},modelId,title:`${c.name}との会話`,updatedAt:new Date().toISOString(),draft:'',
    messages:c.intro?[{id:crypto.randomUUID(),role:'assistant',content:c.intro,state:'complete'}]:[]};
}
