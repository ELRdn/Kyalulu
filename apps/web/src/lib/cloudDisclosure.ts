// Versions the bundled UI actually knows how to explain. Never authorize a
// freshly fetched opaque version with stale provider disclosure text.
const BASE = '2026-10-03-provider-routing-v2';
const KNOWN: Record<string,string> = {
  'opencode-go': BASE,
  'deepseek': BASE+'-direct-deepseek',
  'openrouter': BASE+'-openrouter-inferencenet-deepseek-v2',
};
export function understoodDisclosure(provider:unknown,version:unknown):string|null {
  if(typeof provider!=='string'||typeof version!=='string') return null;
  const expected=Object.hasOwn(KNOWN,provider)?KNOWN[provider]:null;
  return expected===version?expected:null;
}
