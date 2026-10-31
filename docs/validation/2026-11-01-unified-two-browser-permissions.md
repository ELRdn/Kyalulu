# Remote management: two simultaneous browser principals

The existing real Chromium → Noise → loopback Relay → Host → isolated Runtime
acceptance now registers a second device in a separate Chromium context. Its
IndexedDB, device ID, private key and Relay token are independent; both devices
pin the same PC owner, Host ID and Host public key. This is two isolated contexts
in one Chromium instance on Windows, not two physical devices or separate PCs.

Both encrypted connections remain open while the PC-local management API applies
this matrix. The two diagnostic requests at each step execute concurrently:

| Enabled principals | First diagnostic | Second diagnostic |
|---|---:|---:|
| Neither | 403 | 403 |
| First | 200 | 403 |
| Both | 200 | 200 |
| Second | 403 | 200 |
| Neither again | 403 | 403 |

At every step, each principal's administrative status matches the PC vault and
Host authorization. Immediately after each PC-local update, the complete Host
configuration and persisted vault must equal an independent expected copy with
only that principal's management flag changed. Each tries to invert its own
permission over Remote and receives 403; both complete configurations must still
match that same expected copy, including the other principal and registered keys.
Both can read the original conversation history throughout. Connection identities
and the complete stored registration records remain unchanged. The previous
single-device management/research, interrupted generation, draft/reload,
reconnect and device-revocation checks remain in the same driver.

Local evidence on source based on `6c508d7` plus this test-only change:

- Final `python -B tests/e2e_remote.py`: **20 checks passed**, including all five
  matrix states, ten concurrent diagnostic results, ten administrative-status
  results, ten denied self-permission edits and ten unchanged history reads.
- Earlier runs also passed 20 checks; the final run additionally asserts
  distinct private keys/tokens, common pinned Host identity and unchanged state
  immediately after every local update and rejected self-permission edit.
- An independent static review found a cross-principal mutation gap in the first
  version. Complete Host/vault comparisons after each operation close it; the
  reviewer rechecked that fix without finding another concrete defect.
- Corresponding-source fixture/module/helper closure and the existing
  `test_two_device_management_permissions`: **4 passed**.
- No external network attempts or browser page errors. The browser and Relay
  closed; the owned Vite process exited after explicit termination.

Private final evidence is `.artifacts/remote-v1/e2e-450297a1/acceptance.json`,
`.artifacts/remote-two-browser-reviewed-20261101.log` and
`.artifacts/remote-source-closure-20261101.log`. The driver is already included
by the corresponding-source collector and Runtime/Web CI; no new dependency,
workflow step or product permission behavior was introduced.

Physical Android/iPhone, independent browser processes, another PC, real model
management, production TLS and production deployment remain separate acceptance
requirements. This result does not close those gates.
