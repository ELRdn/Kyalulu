import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

// No shell, links, arbitrary member types, absolute paths, or traversal.
export async function extractTarGz(input, root, required='bundle.json') {
  const tar = gunzipSync(input, { maxOutputLength: 2_000_000_000 });
  let offset = 0, total = 0;
  const paths = new Set();
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset+512);
    if (header.every(x => x === 0)) break;
    const str = (start, length) => header.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'');
    const prefix = str(345,155);
    const name = (prefix ? prefix+'/' : '')+str(0,100);
    const type = str(156,1);
    const size = Number.parseInt(str(124,12).trim() || '0',8);
    const checksum = Number.parseInt(str(148,8).trim(),8);
    const sum = header.reduce((n,b,i) => n+(i>=148 && i<156 ? 32 : b),0);
    if (sum !== checksum || !Number.isSafeInteger(size) || size<0) throw Error('Invalid tar header');
    const clean = name.replace(/\/$/,'');
    if (!clean || name.includes('\\') || name.includes(':') || name.startsWith('/') || clean.split('/').some(p => !p || p==='.' || p==='..') || paths.has(clean)) throw Error('Unsafe archive member');
    if (!['0','','5'].includes(type)) throw Error('Links and extended tar members are forbidden');
    paths.add(clean);
    total += size;
    if (total>2_000_000_000 || offset+512+size>tar.length) throw Error('Archive exceeds limit');
    const target = path.resolve(root, clean);
    if (!target.startsWith(path.resolve(root)+path.sep)) throw Error('Archive path escapes install directory');
    if (type==='5') await mkdir(target, {recursive:true});
    else {
      await mkdir(path.dirname(target), {recursive:true});
      await writeFile(target, tar.subarray(offset+512,offset+512+size), {flag:'wx'});
      const mode = Number.parseInt(str(100,8).trim() || '644',8);
      if (mode & 0o111) await chmod(target,0o755);
    }
    offset += 512+Math.ceil(size/512)*512;
  }
  if (!paths.has(required)) throw Error('Missing archive descriptor: '+required);
}
