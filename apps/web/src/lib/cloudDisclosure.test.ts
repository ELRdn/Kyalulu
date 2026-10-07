import {expect,it} from 'vitest';
import {understoodDisclosure} from './cloudDisclosure';
it('accepts only the provider text version compiled into this UI',()=>{
  expect(understoodDisclosure('openrouter','2026-10-03-provider-routing-v2-openrouter-inferencenet-deepseek-v2')).toBeTruthy();
  expect(understoodDisclosure('opencode-go','2026-10-03-provider-routing-v2')).toBeTruthy();
});
it('rejects a newly fetched version that stale text cannot explain',()=>{
  expect(understoodDisclosure('openrouter','future-provider-policy')).toBeNull();
  expect(understoodDisclosure('opencode-go','2026-10-03-provider-routing-v2-openrouter-inferencenet-deepseek-v2')).toBeNull();
});
it('rejects unknown providers and missing versions',()=>{
  expect(understoodDisclosure('future-provider','new')).toBeNull();
  expect(understoodDisclosure('constructor','toString')).toBeNull();
  expect(understoodDisclosure(null,null)).toBeNull();
});
