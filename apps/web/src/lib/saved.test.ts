import { afterEach, expect, it, vi } from 'vitest';
import { toggleSaved } from './saved';
import { setCloud, setCloudOwner } from './cloudMode';

const change=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('./accountProfile',()=>({accountProfile:()=>({saved_characters:['account-only']}),changeAccountProfile:change}));
afterEach(()=>{setCloud(false);vi.unstubAllGlobals();vi.clearAllMocks();});
function setup(){
  const values=new Map<string,string>(),location={origin:'https://app.kyalulu.com',hostname:'app.kyalulu.com',pathname:'/'};
  vi.stubGlobal('location',location);vi.stubGlobal('window',Object.assign(new EventTarget(),{location}));
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  setCloud(true);setCloudOwner('');return values;
}
it('keeps guest favorites in this browser without an account write and supports removal',()=>{
  const values=setup();toggleSaved('guest-guide');
  expect([...values.values()]).toEqual(['["guest-guide"]']);
  toggleSaved('guest-guide');expect([...values.values()]).toEqual(['[]']);
  expect(change).not.toHaveBeenCalled();
});
it('keeps guest favorites separate across login, logout and local execution',()=>{
  const values=setup();toggleSaved('guest-guide');const guest=[...values.keys()][0];
  setCloudOwner('signed-in');toggleSaved('account-guide');
  expect(change).toHaveBeenCalledExactlyOnceWith({toggle_saved:'account-guide'});
  expect(values.get(guest)).toBe('["guest-guide"]');expect(values.size).toBe(1);
  setCloudOwner('');toggleSaved('guest-guide');expect(values.get(guest)).toBe('[]');
  setCloud(false);toggleSaved('local-guide');
  expect(values.size).toBe(2);expect(values.get(guest)).toBe('[]');
});
