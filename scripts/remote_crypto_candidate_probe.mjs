// Reproduce the alternative AESGCM library's low-order X25519 behavior.
// This only uses public test material, not real user identities.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { dh } = require(resolve('.artifacts/remote-v1/node_modules/@niomon/noise-js/dist/dh.js'));
let report;
try {
  const result = dh(Buffer.alloc(32, 7), Buffer.alloc(32));
  report = { library: '@niomon/noise-js@2.0.1', allZeroRemoteKey: 'accepted',
    sharedSecret: result.toString('hex'), gate: 'NOT_QUALIFIED' };
} catch (error) {
  report = { library: '@niomon/noise-js@2.0.1', allZeroRemoteKey: 'rejected',
    error: String(error), gate: 'REQUIRES_REVIEW' };
}
writeFileSync(resolve('.artifacts/remote-v1/alternative-probe-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = 2;
