import { beforeEach,expect,it,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedDiagnostics } from './SavedDiagnostics';
const fixture=vi.hoisted(()=>({language:'ja'}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language}));
vi.mock('./RuntimeMedia',()=>({RuntimeDownload:({href,children}:any)=><a href={href}>{children}</a>}));
beforeEach(()=>{fixture.language='ja';});
it.each(['ja','en'])('distinguishes saved, erased, missing and corrupt evidence in %s',language=>{
  fixture.language=language;
  for(const state of ['stored','erased','unavailable','corrupt'] as const){
    const html=renderToStaticMarkup(<SavedDiagnostics info={{state,bytes:2000000,export_url:'/api/chat/generations/id/diagnostics'}} />);
    expect(html).toContain('role="status"');expect(html).toContain('2,000,000');
    expect(html).toContain(language==='ja'?'診断データを書き出す':'Export diagnostics');expect(html).not.toContain('(none)');
    expect(html).toContain(language==='ja'?{stored:'保存済み',erased:'消去',unavailable:'利用できません',corrupt:'整合性'}[state]
      :{stored:'are saved',erased:'were removed',unavailable:'unavailable',corrupt:'could not be verified'}[state]);
  }
});
it('never turns an external diagnostic URL into a Runtime export',()=>{
  const html=renderToStaticMarkup(<SavedDiagnostics info={{state:'corrupt',export_url:'https://external.invalid/private'}} />);
  expect(html).not.toContain('<a');expect(html).not.toContain('external.invalid');
});
it('handles an older or malformed Runtime descriptor without exposing a false byte count or link',()=>{
  const html=renderToStaticMarkup(<SavedDiagnostics info={{state:'unknown',bytes:Infinity,export_url:{path:'/api/private'}} as any} />);
  expect(html).toContain('利用できません');expect(html).not.toContain('<a');expect(html).not.toContain('bytes');
});
