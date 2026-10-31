# jsonChunks の UTF-8 encode 集約（2026-10-31）

## 範囲と freeze

- Authoritative checkout: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`, baseline `e21f63b`。
- 商品コード変更は `apps/web/src/lib/appTransfers.ts` の `jsonChunks` 関数のみ。`jsonText`、upload/download、ACK/outbox、Git/CI/依存には変更を加えない。
- 呼び出し元は `uploadSync` の validation/upload の2走査と `segmentedStorage.ts` の保存・会話書き換え。1MiB単位のpart、最終part長、SHA manifestの契約を維持する。
- 単独Node診断は担当入力に限定する。統合ソースでの最終検証は末尾の記録を参照する。
- 以下は担当ソース限定の独立Node診断。全Web走査をせず、実行前後の `appTransfers.ts` / 担当test、serializer抽出ソース、旧oracle、入力のSHAを明示する。親の `appSync.ts` / `appStore.ts` は入力に含まない。これらの編集後の全Web商品指紋を証明しない。

## 最小変更と上限

`jsonText` iteratorの隣接断片を、合計が16,384 UTF-16 code units以下なら連結して1回の `TextEncoder.encode` に渡す。単一の既存断片が閾値を超える場合はそのままencodeする。全文stringify・全断片配列・helper・optionは追加しない。従来の1MiB byte bufferへの転記処理はそのまま。

`jsonText` の1断片は最大4,096入力文字×6 escape文字 = 24,576 UTF-16 code units。従ってencode対象の `text` は最大24,576で、既存testのencode上限を緩めない。先読みは1断片のみで、`text` と先読み断片の論理文字数合計は最大49,152。元のscalar string/treeは引き続き保持される。この上限はJS engineのrope表現やRSSの上限を意味しない。

先読みにより不正値の検出・getter評価が旧実装より最大1 encode batch分前に進む場合がある。出力済みpartの後もvalidationを継続し、65階層/cycle/不正prototype/BigIntを拒否する。iterator中断時は未走査のtailを評価しない。同期した入力への2回走査という既存uploadの前提は変更していない。

## 検証

`appTransfers.test.ts` に baseline `e21f63b` の独立oracleを固定し、次を旧byte列・part長・part SHA・全体SHAおよび該当する値の `JSON.stringify` と比較する。

- 微小値/指数表記/最大有限値/-0/nonfinite、undefined/function/symbolの省略と配列null化、疎配列。
- Object.keys順、整数キー、非列挙・symbolキー、null prototype、own `__proto__`、共有参照。既存のobject `toJSON` 非呼び出しも維持。
- 4,096文字・16KiB encode・1MiB partの前後にastral/unpaired surrogate、quote/backslash、制御文字を配置。part長は1MiB-1/1MiB/1MiB+1を含む。
- encode呼び出し削減、encode対象文字数、コンテナ全文stringify禁止。不正値が最初のpartの後にある場合の拒否とiterator中断。
- 元のuploadの再開、receipt、account/consent中断、manifest、download検証のtestは変更しない。

ローカル `TEMP` / `TMP` は既存 `.artifacts`。既存Node/TypeScript/Vitestのみを利用し、download・外部接続・モデル・production実行はしない。

```powershell
$env:TEMP='D:/VibeCoding/my zeta/.artifacts'
$env:TMP=$env:TEMP
# cwd: D:/VibeCoding/my zeta/apps/web
node node_modules/vitest/vitest.mjs run src/lib/appTransfers.test.ts src/lib/jsonStream.test.ts src/lib/deviceHistoryStorage.test.ts src/lib/deviceGenerationStorage.test.ts --pool threads --maxWorkers 1 --no-cache
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck --strict src/lib/appTransfers.ts src/lib/appTransfers.test.ts
```

## 独立Node診断の再実行

入力はprivate `.artifacts/device-research-browser/en-experiment.json`（既存8turn export）と、そのturn配列を同じ順番で100要素へ循環反復したshape。実100turnのexportではない。入力構築/compile/計装は時間計測の外。Node crypto SHA計算を含めたserializer消費を、同じ入力に対し旧→新の順番で比較する。各入力3組warmup、7組採取。速度のtest閾値は設けない。

診断を新規scriptファイルに保存せず、repo rootからこの文書のブロックを実行する:

```powershell
$env:TEMP='D:/VibeCoding/my zeta/.artifacts'
$env:TMP=$env:TEMP
$doc=Get-Content -Raw docs/validation/2026-10-31-unified-json-encoding.md
[regex]::Match($doc,'(?ms)^<!-- serializer-probe-start -->\r?\n```javascript\r?\n(.*?)\r?\n```\r?\n<!-- serializer-probe-end -->').Groups[1].Value | node
```

<!-- serializer-probe-start -->
```javascript
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const ts=require('./apps/web/node_modules/typescript');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const sourcePath='apps/web/src/lib/appTransfers.ts',testPath='apps/web/src/lib/appTransfers.test.ts';
const source=fs.readFileSync(sourcePath,'utf8'),test=fs.readFileSync(testPath,'utf8');
const baseline=execFileSync('git',['show','e21f63b:'+sourcePath],{encoding:'utf8'});
const section=s=>s.slice(s.indexOf('function* jsonText('),s.indexOf('export async function uploadSync(')).replace('export function*','function*');
const normalize=s=>s.replace(/\r\n/g,'\n').trim();
const legacy=test.slice(test.indexOf('function* legacyJsonText('),test.indexOf('function expectLegacy(')).replaceAll('legacyJson','json').replaceAll('chunkBytes','CHUNK_BYTES');
assert.equal(normalize(legacy),normalize(section(baseline).replace(/\/\/ shortcut:.*\r?\n/,'')));
assert.equal(normalize(source.slice(0,source.indexOf('export function* jsonChunks('))),normalize(baseline.slice(0,baseline.indexOf('export function* jsonChunks('))));
assert.equal(normalize(source.slice(source.indexOf('export async function uploadSync('))),normalize(baseline.slice(baseline.indexOf('export async function uploadSync('))));
const constant=source.match(/const CHUNK_BYTES=([^;]+);/)[0];
const compile=(body,Encoder=TextEncoder,observe=()=>{})=>new Function('TextEncoder','observe',ts.transpileModule(constant+'\n'+body+'\nreturn jsonChunks;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(Encoder,observe);
const oldRun=compile(section(baseline)),newRun=compile(section(source));
const fixturePath='.artifacts/device-research-browser/en-experiment.json',fixture=fs.readFileSync(fixturePath);
const original=JSON.parse(fixture),repeated={...original,turns:Array.from({length:100},(_,i)=>original.turns[i%original.turns.length])};
const consume=(run,input)=>{
  const digest=crypto.createHash('sha256'),lengths=[],partHashes=[];
  for(const part of run(input)){digest.update(part);lengths.push(part.length);partHashes.push(sha(part));}
  return {lengths,partHashes,sha256:digest.digest('hex')};
};
const results=[];
for(const [label,input] of [['actual8turnexport',original],['repeated100turnshape',repeated]]){
  const expected=new TextEncoder().encode(JSON.stringify(input)),reference=consume(oldRun,input);
  assert.equal(reference.sha256,sha(expected));assert.deepEqual(consume(newRun,input),reference);
  const observations={};
  for(const [name,body] of [['old',section(baseline)],['new',section(source)]]){
    let calls=0,maxText=0,maxLookahead=0,maxCombined=0;
    class Encoder extends TextEncoder {encode(text){calls++;maxText=Math.max(maxText,text.length);return super.encode(text);}}
    const instrumented=name==='new'?body.replace('const raw=encoder.encode(text);','observe(text.length,step.done?0:step.value.length);const raw=encoder.encode(text);'):body;
    const run=compile(instrumented,Encoder,(text,next)=>{maxLookahead=Math.max(maxLookahead,next);maxCombined=Math.max(maxCombined,text+next);});
    assert.deepEqual(consume(run,input),reference);
    observations[name]={encodeCalls:calls,maxTextUTF16:maxText,maxLookaheadUTF16:maxLookahead,maxCombinedUTF16:maxCombined};
  }
  for(let i=0;i<3;i++){assert.deepEqual(consume(oldRun,input),reference);assert.deepEqual(consume(newRun,input),reference);}
  const samples=[];
  for(let i=0;i<7;i++){
    const pair={};
    for(const [name,run] of [['old',oldRun],['new',newRun]]){
      const start=performance.now(),output=consume(run,input);pair[name]=performance.now()-start;assert.deepEqual(output,reference);
    }
    samples.push(pair);
  }
  const median=name=>samples.map(s=>s[name]).sort((a,b)=>a-b)[3];
  results.push({label,turns:input.turns.length,bytes:expected.length,inputSHA256:sha(expected),...reference,observations,samplesMs:samples,medianMs:{old:median('old'),new:median('new')}});
}
const escapedInput={text:'\u0000'.repeat(4096*8)},bounds={maxTextUTF16:0,maxLookaheadUTF16:0,maxCombinedUTF16:0};
const bounded=compile(section(source).replace('const raw=encoder.encode(text);','observe(text.length,step.done?0:step.value.length);const raw=encoder.encode(text);'),TextEncoder,(text,next)=>{
  bounds.maxTextUTF16=Math.max(bounds.maxTextUTF16,text);bounds.maxLookaheadUTF16=Math.max(bounds.maxLookaheadUTF16,next);bounds.maxCombinedUTF16=Math.max(bounds.maxCombinedUTF16,text+next);
});
assert.deepEqual(consume(bounded,escapedInput),consume(oldRun,escapedInput));
assert.deepEqual(bounds,{maxTextUTF16:24576,maxLookaheadUTF16:24576,maxCombinedUTF16:49152});
assert.equal(fs.readFileSync(sourcePath,'utf8'),source);assert.equal(fs.readFileSync(testPath,'utf8'),test);
const diagnostic=fs.readFileSync('docs/validation/2026-10-31-unified-json-encoding.md','utf8').match(/^<!-- serializer-probe-start -->\r?\n```javascript\r?\n([\s\S]*?)\r?\n```\r?\n<!-- serializer-probe-end -->/m)[1];
console.log(JSON.stringify({node:process.version,nodeExecutable:process.execPath,typescript:ts.version,compilerTarget:'ES2022',sourceSHA256:sha(source),testSHA256:sha(test),constant,serializerSHA256:sha(section(source)),baselineSerializerSHA256:sha(section(baseline)),oracleSHA256:sha(legacy),diagnosticSHA256:sha(diagnostic),fixtureSHA256:sha(fixture),sourceUnchangedDuringRun:true,bounds,results},null,2));
```
<!-- serializer-probe-end -->

## 結果と限界

2026-10-31 19:57 JSTの関連4 suiteは **49 passed**。上記strict型検査と担当diffの `git diff --check` は成功。既存testのassertionは変更していない。baseline前半（`jsonText`を含む）・後半（upload/download）の一致、test内旧oracleのbaseline一致を診断内assertでも確認した（CRLFと関数間の既存shortcutコメントを除く）。

計装を加えた診断再実行結果は以下。Node `v26.5.1`（`C:/Program Files/nodejs/node.exe`）、TypeScript `5.9.3`、transpile target `ES2022`。時間はserializer消費と全体/part SHA計算を含む。各組の実行順は旧→新で固定しているため、順序・JIT/GC・他プロセスの影響を含み、一般的速度保証ではない。

| 入力 | bytes / parts | encode呼び出し 旧→新 | 中央値ms 旧→新 |
| --- | --- | --- | --- |
| actual8turnexport | 149,562 / 1 | 24,192 → 7 | 13.4493 → 4.2864 |
| repeated100turnshape | 1,768,286 / 2 | 282,805 → 81 | 162.0833 → 56.7473 |

反復100turn shapeはpart長 `[1048576,719710]`。旧/新とも全体SHA `8efe63750643ce5ca3054d3f3330d5f1cd89ab5b9091e39e89b59e377591126c`、part SHAは順に `c695befe34d83db7f1318e15fa7b5adf5cbee1cb4ac51f426ba4fecff203eacc` / `a2b2b184b854b7fbc124a61bb44b540922ff1caa4dacb115a07e1d03e462d3da`。8turnは全体/唯一のpartともfixture SHAに一致する。

7組の採取値（ms、表示は小数4桁）:

| 組 | 8turn旧 | 8turn新 | 100shape旧 | 100shape新 |
| --- | --- | --- | --- | --- |
| 1 | 13.8543 | 3.9987 | 156.7628 | 60.5088 |
| 2 | 14.0823 | 5.7822 | 165.8052 | 50.4505 |
| 3 | 13.4099 | 4.1954 | 157.9697 | 51.8192 |
| 4 | 13.8542 | 4.2864 | 162.0833 | 61.7510 |
| 5 | 11.5381 | 3.9746 | 155.1689 | 56.7473 |
| 6 | 13.1355 | 4.3587 | 170.1164 | 50.5776 |
| 7 | 13.4493 | 4.9503 | 229.9116 | 72.8356 |

新実装のencode対象 `text` の実測最大は両shapeとも16,384 UTF-16文字。先読み最大は8turnが166、100shapeが2,021、`text+先読み` 最大はそれぞれ16,527 / 18,202。別途4,096×8個のNUL文字を持つ入力で計装し、`text` 最大24,576 / 先読み最大24,576 / 合計最大49,152を観測・assertし、旧出力との一致も確認した。計装runは時間計測に含めない。

担当入力のSHA-256（実行前後で商品ソース/test内容が不変であることをassert）:

| 対象 | SHA-256 |
| --- | --- |
| `apps/web/src/lib/appTransfers.ts` 全体 | `179abb5cb8923a9107033d14d6d5e80fa258fd39872cc41fca4d43171ac0c1e4` |
| `apps/web/src/lib/appTransfers.test.ts` 全体 | `a83d1a92acc3ff2ad860df3a18a105013e998ff76149186ab51515e72b58f011` |
| 新 `jsonText/jsonChunks` 抽出（export除去） | `0271a69eae4aac62f89e163d8411a3091251935fe2c1136c4b9d13ad2ed5029c` |
| baseline同抽出 | `eaa6e17fb3660db702ee9123ac4380784f696b0c2ed27fad1d4f143911d15f6e` |
| test内旧oracle抽出（関数名/定数名を戻した形） | `8af4054fe3009046833182eb8fa79cad5510194d6aacbd135cd77b33cc9991d1` |
| 上記診断JavaScriptブロック | `7c154ec31abe557e5532ad23fd031297bc28c485f29a1656713bf9ce19b3dc78` |
| private既存8turn fixture | `de6ad37ba74c814837c78c078bb0e220836d2a4243292d67304349ccbcdf5ba7` |
| 反復100turn入力（JSON UTF-8） | `8efe63750643ce5ca3054d3f3330d5f1cd89ab5b9091e39e89b59e377591126c` |

serializer入力にはこの抽出ソースのほか `const CHUNK_BYTES=1024*1024;` と上記compiler設定を使う。ソース全体hashにはCRLF/LF差も反映される。親が並行編集する `appSync.ts` / `appStore.ts` のhashは対象外。

この単独診断を実100turn、RSS/heap、モデル品質、250MB/1GB容量、production受入れには代用しない。

## 統合ソースでの追加検証

同期ACK変更と合わせたソースを固定し、全Web **1,456件/92files**、型検査、統合build **10.44秒** が成功した。
[通常ACKの実Chromium15ケース](2026-10-31-unified-sync-ack.md)では5,045,278 bytes/5partsの受領・破損・quota・ownerを確認し、
全326入力hashは不変。既存Researchの実Chromium19ケースも4,566,410 bytes/5partsで再確認し、325入力hashが不変だった。
対応source closure3件も成功。これらは共有writerを呼ぶ保存/書換経路の統合証拠であり、実100turnの速度や完全なactorメモリ上限を示さない。
