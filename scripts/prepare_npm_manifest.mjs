// Assemble reviewed artifact manifests. This never publishes anything.
import {readFile,writeFile} from 'node:fs/promises';
import {validateManifest} from '../packages/launcher/src/launcher.mjs';
const files=process.argv.slice(2);
if(files.length!==2) throw Error('Provide the Windows and Apple Silicon reviewed manifests');
const inputs=await Promise.all(files.map(async file=>JSON.parse(await readFile(file,'utf8'))));
if(inputs.some(x=>x.gates?.device_accepted!==true || x.gates?.license_reviewed!==true)) throw Error('Real target-device and license acceptance are required');
if(inputs[0].release!==inputs[1].release) throw Error('Artifact release versions differ');
const packageInfo=JSON.parse(await readFile(new URL('../packages/launcher/package.json',import.meta.url),'utf8'));
if(inputs[0].release!==packageInfo.version) throw Error('Runtime release must match the npm package version');
for(const input of inputs){
  const targets=Object.keys(input.artifacts || {});
  if(targets.length!==1 || !['win32-x64','darwin-arm64'].includes(targets[0])) throw Error('Each reviewed manifest must contain one supported native artifact');
  validateManifest(input,targets[0]);
}
const artifacts=Object.assign({},...inputs.map(x=>x.artifacts));
if(!artifacts['win32-x64'] || !artifacts['darwin-arm64']) throw Error('Both target artifacts are required');
await writeFile(new URL('../packages/launcher/runtime-manifest.json',import.meta.url),JSON.stringify({schema:1,release:inputs[0].release,artifacts},null,2)+'\n');
