# Unified PWA language, explicit updates and offline browser restart

Product source: `48328d7` (Native static-document policies from `9caa685`).
This phase adds JA/EN PWA status, installation/update controls, retained error
messages and confirmation text. Errors are stored as stable keys and rendered
in the current language. The confirmation uses the language at the time of the
action. A generation in progress still blocks the action before confirmation;
canceling confirmation never posts an update request.

The previous server-mode sentence said conversations were never available
offline. It now refers to the selected execution target and storage policy,
without claiming that every conversation has been downloaded.

## Local checks

- PWA worker/client and status component: **13 passed**, including generation
  blocking, canceled JA/EN confirmations, explicit-only update requests, the
  other-tab rejection, all retained error messages, language changes and disabled
  offline controls. Existing worker privacy/cache boundaries remain covered.
- Full collected-source Web suite: **694 passed / 53 files**.
- Web typecheck and collected-source `build:app`: passed. Existing upstream Vite
  script/externalization/chunk warnings remain.
- `tests/e2e_unified_pwa.py`: **2 Chromium conditions passed**, JA 393px light
  and EN 1280px dark, against actual built HTML/JS/CSS, the actual Native
  `WebDist` server, Service Worker, IndexedDB and localStorage.

The source was collected from a clean Git export into a fresh validation
directory on a drive with sufficient free space; dependencies were installed
with `--frozen-lockfile --offline --ignore-scripts`. Existing WASM build outputs
were copied only as build inputs. No uncommitted Core or unrelated work was used.

## Browser evidence

Each condition performs the following through the real App:

1. Open the unified entry document and wait for first Service Worker control;
   this document is not cross-origin isolated.
2. Seed only fictional eligibility/preferences in the disposable browser and
   open `/device/`. Check `crossOriginIsolated`, `SharedArrayBuffer`, and CSP
   permission to compile an empty WASM module.
3. Open a bundled general character, create a conversation and enter a Japanese
   draft. No model is prepared and nothing is generated or sent.
4. Change only a local fixture worker-version marker, keeping app asset bytes
   and precache integrity unchanged. Check for updates through the status UI.
5. Open another Kyalulu tab; confirm an update and observe the translated
   rejection, the waiting worker and the retained draft. Close that tab, confirm
   again and observe reload, activation of the new cache version and draft
   restoration. No automatic activation is used.
6. Disable network traffic and reload from the installed worker. Confirm the
   saved conversation/draft and isolation. A fetch to an uncached local probe
   must fail, independently proving that the shell is not loading online.
7. Close the entire owned persistent browser context/process. Reopen its exact
   disposable profile with traffic disabled and navigate directly to the saved
   chat. Confirm the worker, conversation, draft and isolation again, without
   injecting an exported browser storage state.
8. Return online and open `/migration/`; it is not cross-origin isolated.

Both conditions recorded **0 API requests, 0 external requests, 0 page errors**,
and no horizontal overflow in the offline conversation viewport. Request
observation is attached to the browser context, including its worker requests;
off-origin requests are also blocked. All runtime work stays in the real device
adapter; no HTTP Runtime is impersonated.

### Renderer offline signal

On this Chromium/Playwright combination, network traffic blocking alone left
`navigator.onLine` true after a worker-served navigation. The script therefore
first proves that uncached traffic fails, then uses the official DevTools
`Network.overrideNetworkState` command while checking/capturing the offline
status label. It does not replace `navigator`, dispatch synthetic window events,
disable CSP or permit `unsafe-eval`. Detaching that DevTools session restores
the renderer signal, so screenshots are captured before detaching.

Offline shell/draft restoration is independently checked with traffic disabled.
The offline label evidence is explicitly based on renderer emulation, not a
physical network switch. An initial test wait also used an expression form that
CSP rejected; it was changed to a function predicate, preserving product CSP.

## Reproduction and limits

After building the unified app and installing the existing Playwright browser:

```text
python tests/e2e_unified_pwa.py --dist <unified-build> --output <fresh-output>
```

The script owns only its loopback process and freshly created browser profiles.
It retains results, logs and screenshots and closes its processes on failure.
The server has no production API or Runtime lifespan. Eligibility, preferences,
worker release markers and typed draft text are fictional fixtures. There is no
real model inference, synchronization, charge, advertising, production access,
user profile reuse or modification of a production Service Worker.

Local summary: `.artifacts/unified-pwa-browser-results.json`. The chosen output
directory also contains `results.json`, `server.log`, retained disposable
profiles and `ja-393-light` / `en-1280-dark` offline/restart screenshots.
The driver is a manual prebuilt-artifact check; normal CI does not build the
pinned WASM toolchain or execute this driver.

This closes the bounded Chromium shell/update/restart check only. It does not
qualify OS IME, Android/iPhone, lock/resume, real network switching, real model
offline execution, full storage capacity, hosted Cloud/Remote routing or all
remaining English UI. Prior unsigned distribution candidates remain identified
by their original source revision and hashes; these UI changes require new
distribution candidates before release.
