# Kyalulu docs — final SEO / AEO / GEO review and publication

Date: 2026-10-05 (Asia/Tokyo). User authorized final review, necessary improvements
and publication to let them check the site from a phone.

## Published result

- Production: **https://kyalulu.com/docs/**
- English: https://kyalulu.com/docs/en/
- Cloudflare Pages project: `kyalulu-landing`, production branch `main`.
- Deployment: https://7571a83c.kyalulu-landing.pages.dev
- Previous production deployment: `c4f3873a-1082-4fbf-8807-c1850109fba8`.
- Public source commit still current at review:
  `ELRdn/Kyalulu@eea271beb3eef9211f8b588db331daf2761ba3e2`.

The previous public Japanese/English landing HTML, CSS and JS matched the local
landing sources after accounting for the newly added Docs links. The complete
static bundle was deployed to that existing project, preserving those pages.
No Git commit, push, DNS change or runtime/API deployment was required.

## Assessment and improvements

| Area | Result and concrete basis |
| --- | --- |
| Crawling and indexing | All 34 docs pages are static HTML, publicly return 200, have indexable robots metadata, self-canonicals, unique titles/descriptions and reciprocal ja/en/x-default hreflang. |
| Discovery | Existing landing navigation links to the docs. Categories, previous/next navigation and contextual article links connect the corpus. The sitemap covers all 36 HTML URLs. |
| Answer extraction | All 32 article translations now begin with three visible, source-supported answers. Ordered steps, tables, question headings, stable section anchors and visible FAQ answers support selective reading and citation. |
| Entity clarity | Linked WebSite, SoftwareApplication and contributor entities identify Kyalulu/キャルル and its official repository. Articles use consistent publisher, about and mainEntityOfPage references. No invented ratings, prices or availability claims. |
| Grounding | Every article links to public, commit-pinned sources. Alpha, implemented scope, historical validation and remaining release conditions remain distinct. Source review dates are not presented as fresh device-test dates. |
| Content/markup consistency | The article abstract matches its visible summary. FAQ answers reflect visible content. Important text does not require JavaScript. |
| Retrieval access | robots.txt explicitly allows OAI-SearchBot and retains wildcard access. Googlebot, bingbot, OAI-SearchBot and ChatGPT-User User-Agent requests received the correct public content without an HTTP challenge. This tests requests from this client, not all crawler IPs. |
| Supplemental AI reading | llms.txt and a full-text reference contain canonical article URLs and source citations. They are optional resources and have noindex headers to avoid plain-text duplicates in search. |
| Phone experience | Responsive navigation and readable article layouts; controls adjusted for narrow screens. Local browser checks cover all pages at 390px and targeted interactions at 320px. Production browser checks cover mobile navigation, tables and the 320px viewport. |

The approach is appropriate for technical discoverability and source-grounded
answers. Actual rankings, index inclusion and AI citations have not been measured
or guaranteed. No real inference was needed for this review.

## Official guidance checked

- [Google: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features): foundational SEO, crawl access, internal links, visible text, page experience and markup matching visible content remain the basis. No special AI text files or schema are required.
- [Google: structured-data documentation updates](https://developers.google.com/search/updates#removing-faq-rich-result): corrected on 2026-10-06 after checking the current official changelog. FAQ rich results stopped appearing in Google Search on 2026-05-07; the earlier government/health-only restriction is historical. Kyalulu's visible FAQ remains useful without promising FAQ rich results. See [the fresh investigation](2026-10-06-search-console-research.md).
- [OpenAI: bots](https://developers.openai.com/api/docs/bots/): OAI-SearchBot supports search discovery; GPTBot is a separate training crawler. Search access and training preferences are distinct. This publication did not introduce a new blanket training-crawler policy.

## Local and production checks

Passed local build/static checks and Chromium acceptance:

```powershell
pnpm build:docs
pnpm check:docs
# With local preview on port 5186:
$env:KYALULU_DOCS_PORT = '5186'
.venv/Scripts/python.exe -B scripts/verify_docs.py
```

All 34 pages at 1440px and 390px passed content, asset, overflow and enforced-CSP
checks. Search, keyboard selection, Escape/focus restoration, actual clipboard
content, translation links, theme persistence, native mobile navigation, tables,
320px layout, real 404s, redirects, JavaScript-disabled navigation and unavailable
storage passed. Browser errors, external requests and inference attempts were zero.

Publication used the existing Wrangler OAuth login and explicit project/production
branch. The environment API token lacked Pages permissions, so it was omitted only
inside the deployment shell; no credential values were copied into the bundle.

Passed production verification:

```powershell
.venv/Scripts/python.exe -B scripts/verify_docs_public.py
$env:KYALULU_DOCS_ORIGIN = 'https://kyalulu.com'
.venv/Scripts/python.exe -B scripts/verify_docs.py --interactions-only
```

- All 34 production HTML responses were byte-identical to the reviewed bundle.
- Exact canonicals, CSP and no-cache headers were confirmed on every page.
- robots.txt and the 36-URL sitemap matched the build.
- Supplemental text was served as text/plain with noindex headers.
- Missing guides and the source directory returned real 404s.
- Clean-path and index.html redirects reached the canonical trailing-slash URL.
- Four crawler User-Agents passed robots.txt and article checks (8 requests).
- Both existing landing translations matched the deployed bundle.
- Production browser interactions passed with zero errors, unrelated external
  requests or inference attempts.

Evidence is stored in `.artifacts/docs-review-public/http-results.json`,
`results.json` and six production screenshots. Pre-deployment metadata and the
previous landing files are in `.artifacts/docs-audit`.

## Observation that remains

Physical-phone checks are for the user to perform using the public URL. Browser
viewport verification is not a physical Android result. Search Console sitemap
submission and later observation of indexing/rankings/citations remain separate;
the public sitemap is already discoverable through robots.txt. The new GitHub
workflow has not been run remotely because no commit/push was performed.
