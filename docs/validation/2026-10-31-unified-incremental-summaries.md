# Incremental Device summary extraction

Device generation now feeds chapter summaries one message at a time, including
the newly generated assistant. The collector retains at most one incomplete
20-message chapter plus completed chapter summaries. It builds arcs from each ten
completed chapters and keeps the existing chapters-before-arcs output order. The
array-based `refreshSummaries` entry remains compatible and uses the same collector.

Excerpt extraction previously converted every complete message body into a Unicode
code-point array to retain only its short excerpt. It now reads at most the excerpt
quota plus one code point from each body and bounds the final text prefix. The
4,000-code-point limit, Unicode behavior, excerpt labels, source IDs, summary IDs,
manual corrections, revision rules and unknown fields are unchanged.

Local validation:

- TypeScript, unified build and all **1,346 Web tests / 84 files** pass.
- Twenty compatibility cases compare the previous chapter/arc and excerpt
  algorithms across empty/full/incomplete chapters and arcs, changed source IDs,
  changed content, existing manual/extractive summaries and extension fields.
- A one-million-code-point message test observes no more than 4,001 iterator
  steps over the source body and compares its result to the previous extraction
  using a sufficient small prefix. It measures bounded character work, not model
  latency or overall browser memory.
- Real Chromium App/Device API/IndexedDB checks pass at JA/393/light and
  EN/1280/dark. Actual UI send closes the eighth chapter at 160 messages; regeneration
  retains the first 159 messages and increments the final chapter revision with
  its replacement assistant source ID. Complete summaries match a separate Python
  expectation. Paging, hidden history, draft/reload, manual edit, owner separation,
  terminal proof and lazy context tools remain exercised. External requests and
  page errors are zero; inference uses a fictional Worker, not weights.

The Windows source-verification fixture timeout was addressed separately in
`fd12651`, without extending its 5-second deadline or changing runtime behavior.
Its current CI result must be observed independently of this local validation.

This is part of the generation storage work, not full streamed generation.
`generateTurn` still opens a complete conversation and owns its full message array;
shared-memory contexts and complete canonical updates also retain full-tree paths.
The collector does not by itself accept 1 GB generation, large-domain memory,
real-model parity, physical devices or production. PR #9 stays Draft and production
cutover remains on hold pending the owner's region conditions.
