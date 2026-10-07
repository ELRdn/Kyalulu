# Kyalulu documentation website

The canonical documentation lives at **https://kyalulu.com/docs/**, with English
translations under `/docs/en/`. It shares the existing landing site's domain,
assets and navigation. The public site remains a dependency-free static bundle.

From the repository root:

```powershell
pnpm build:docs
python scripts/check_docs.py
node scripts/preview_docs.mjs
# Open http://127.0.0.1:5185/docs/
# In a second terminal, with the existing Playwright development dependency:
.venv/Scripts/python.exe -B scripts/verify_docs.py
```

The build writes the complete landing site and 34 docs pages to
`.artifacts/landing-site`. It never publishes or changes Git state. Preview binds
only to loopback, applies the generated Cloudflare headers and serves real 404s.
If the default port is busy, set `KYALULU_DOCS_PORT` to a free port.

## Content and evidence

- `content/user-guides.mjs`: installation, models, characters, memory, worlds, privacy.
- `content/advanced-guides.mjs`: imports, compatibility, mobile, Remote, development, CharacterBench.
- `content/essentials.mjs`: overview, troubleshooting, FAQ, public scope.
- `content/answers.mjs`: visible answer-first summaries in both languages.
- `content/sources.json`: public source commit, review date and source SHA-256 hashes.
- `docs.css` and `docs.js`: responsive layout and optional search/theme/copy enhancements.

Each article has independently authored Japanese and English sections. Internal
references use `{{doc:slug}}`; both translations use matching section IDs. Source
paths must exist in the public manifest. The build rejects missing translations,
duplicate sections, invalid references and unsafe authored markup. Search indexes
contain only this public article content. No runtime, user data or API keys are read.

To add a guide, define it in a content module and register its slug/category/icon in
`scripts/build_docs.mjs`. Run the build and checker. For a source refresh, verify the
public GitHub commit, download only relevant public files into
`.artifacts/docs-sources`, review affected articles, and update `sources.json` with
the commit, review date and actual SHA-256 hashes. A source review date does not
assert fresh device testing. Do not promote unpublished local implementation as a release.

## SEO and deployment

Every docs page contains crawlable HTML, a unique title/description, its own
canonical URL, reciprocal Japanese/English/x-default hreflang, Open Graph and
JSON-LD (CollectionPage or TechArticle, plus breadcrumbs and visible FAQ content).
The sitemap includes both existing landing pages and all 34 docs pages. Visible
answer summaries have matching article abstracts; shared WebSite, SoftwareApplication
and contributor entities identify the project without invented ratings or offers. Review
dates are shown as source review dates; no artificial sitemap modification dates
are generated. Search uses a locally served index fetched only when opened.

`/llms.txt` and `/docs/llms-full.txt` are supplemental reading resources, not
requirements for Google AI features or guarantees of AI citation. They use noindex
headers to keep plain-text duplicates out of search indexes. The canonical HTML
articles remain indexable and are the primary citation targets. OAI-SearchBot is
explicitly allowed; other crawlers retain the existing default access policy.

After deployment is authorized, upload **only `.artifacts/landing-site`** to the
existing landing-site Cloudflare Pages project. Keep the complete landing assets,
`_headers`, `_redirects`, `404.html`, `robots.txt` and `sitemap.xml`. Do not use an
SPA fallback: unknown docs routes must return 404 instead of the landing page.
An automatic Git build may use `node scripts/build_docs.mjs` and output directory
`.artifacts/landing-site`; the dedicated docs workflow prepares an artifact without
deploying it. No DNS or new subdomain is needed.

After publishing, verify the public `/docs/` pages, redirects, canonical URLs,
headers, sitemap and 404 status. Submit `https://kyalulu.com/sitemap.xml` in the
site's existing Google Search Console property. This enables discovery; rankings
and indexing are determined by search engines and are not asserted by the build.

Read-only verification of the published production site:

```powershell
.venv/Scripts/python.exe -B scripts/verify_docs_public.py
$env:KYALULU_DOCS_ORIGIN = 'https://kyalulu.com'
.venv/Scripts/python.exe -B scripts/verify_docs.py --interactions-only
Remove-Item Env:KYALULU_DOCS_ORIGIN
```

The site was deployed to the existing `kyalulu-landing` production project on
2026-10-05. See `docs/validation/2026-10-05-docs-seo-publication.md` for the final
SEO/AEO/GEO review and production evidence.
