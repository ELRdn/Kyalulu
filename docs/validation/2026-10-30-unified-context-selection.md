# Device generation context selection

`apps/web/src/mobile/context.ts` previously recounted the entire remaining history and
removed its first group on every iteration. Long histories repeatedly encoded old
content and copied arrays before reaching the same 2,048-token context bound.

The default conservative counter now reserves every system turn and the latest user
suffix, then accepts complete older removal groups from the end. It preserves message
order, omitted counts, the output reserve, errors and saved input. Custom counters,
including the ONNX tokenizer callback, retain the existing loop. Callers, model
settings, exports and dependencies are unchanged.

## Local validation

- Four permanent regression tests compare the previous loop across system/group
  boundaries, exact budgets, mandatory overflow and async nonadditive callbacks.
- A 50,004-turn case with an exact mandatory budget encodes four mandatory strings
  and none of the 50,000 omitted turns. The quadratic reference runs only on small
  fixtures. This counts work; it is not a device latency benchmark.
- The full Web suite passes: 1,252 tests in 83 files. The affected context, Mobile,
  sampling and Device generation tests pass separately (37 tests). TypeScript passes.
- The unified Vite production build passes with the configured Relay origin and a
  separate artifact output directory. It is a local build, not a deployed candidate.

## Limits

This changes generation-time selection only. Worker history transfer, merging
consecutive turns, decoded storage trees and rendering can still materialize full
histories. The separate 1 GB storage restoration remains unaccepted under its 4 GiB
test budget. Physical Android/iPhone, actual-model quality and production acceptance
are not established by these checks. No production configuration or service changes
are part of this repair.
