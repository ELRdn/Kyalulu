import { expect, it } from 'vitest';
import { deviceSourceMatches } from './deviceImport';
import { PortableDocumentSchema } from '../../../../packages/schemas/src';
import { newEntity, type AppEntity } from './appStore';

const remote={source:'github',source_id:'fixture/card.json',sha256:'a'.repeat(64),document_index:0};
const document=PortableDocumentSchema.parse({name:'Original',source:{remote}});
const entry=(owner:string,id:string,source=remote,deleted=false):AppEntity=>({...newEntity('character',id,{document:{...document,source:{remote:source}}},owner),deleted});

it('matches the complete source tuple only within the owning live Library',()=>{
  const records=[entry('owner','match'),entry('other','foreign'),entry('owner','deleted',remote,true),
    entry('owner','other-hash',{...remote,sha256:'b'.repeat(64)}),entry('owner','other-index',{...remote,document_index:1})];
  const before=structuredClone(records);
  expect(deviceSourceMatches(document,records,'owner').map(row=>row.id)).toEqual(['match']);
  expect(records).toEqual(before);
});

it('does not infer provenance for ordinary files or incomplete source claims',()=>{
  const records=[entry('owner','first')];
  expect(deviceSourceMatches(PortableDocumentSchema.parse({name:'Local'}),records,'owner')).toEqual([]);
  expect(deviceSourceMatches({source:{remote:{author:'Unknown'}}},records,'owner')).toEqual([]);
  expect(deviceSourceMatches({source:{remote:'invalid'}},records,'owner')).toEqual([]);
});
