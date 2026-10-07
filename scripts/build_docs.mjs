import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import essentials from '../apps/landing/docs/content/essentials.mjs';
import userGuides from '../apps/landing/docs/content/user-guides.mjs';
import advancedGuides from '../apps/landing/docs/content/advanced-guides.mjs';
import answers from '../apps/landing/docs/content/answers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const landing = path.join(root, 'apps/landing');
const output = path.join(root, '.artifacts/landing-site');
const manifest = JSON.parse(await readFile(path.join(landing, 'docs/content/sources.json'), 'utf8'));
const origin = 'https://kyalulu.com';
const order = ['overview', 'quickstart', 'models', 'characters', 'imports', 'memory', 'worlds', 'mobile', 'remote', 'development', 'characterbench', 'compatibility', 'privacy', 'troubleshooting', 'faq', 'release-status'];
const articles = [...essentials, ...userGuides, ...advancedGuides].sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
const articleIcons = { overview: 'spark', quickstart: 'arrow', models: 'code', characters: 'heart', imports: 'book', memory: 'spark', worlds: 'heart', mobile: 'phone', remote: 'phone', development: 'code', characterbench: 'code', compatibility: 'file', privacy: 'file', troubleshooting: 'tool', faq: 'question', 'release-status': 'file' };
for (const article of articles) article.icon = articleIcons[article.slug];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plain = html => html.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const route = (lang, slug = 'index') => `/docs/${lang === 'en' ? 'en/' : ''}${slug === 'index' ? '' : `${slug}/`}`;
const link = (lang, slug) => route(lang, slug);
const groups = [
  { id: 'start', ja: 'はじめる', en: 'Get started', icon: 'spark' },
  { id: 'use', ja: 'キャラクターと話す', en: 'Make it your story', icon: 'heart' },
  { id: 'connect', ja: 'スマホにつなぐ', en: 'Connect your phone', icon: 'phone' },
  { id: 'build', ja: '開発・評価する', en: 'Build & evaluate', icon: 'code' },
  { id: 'reference', ja: 'リファレンス', en: 'Reference', icon: 'file' },
];
const symbols = {
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4M10 5h4"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13Z"/>',
  book: '<path d="M12 5v16m0-16C8 2 3 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-1-1-6-2-10 1Z"/>',
  tool: '<path d="m14 6 4 4m-9 4-6 6 2 2 6-6m4-14a6 6 0 0 0-7 8l6 6a6 6 0 0 0 8-7l-4 4-5-5 4-4Z"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name] || symbols.book}</svg>`;
const words = {
  ja: { home: 'ドキュメント', search: 'ガイドを検索', searchHint: 'やりたいこと、キーワードで検索', close: '閉じる', menu: 'ガイド一覧', theme: '配色を切り替える', contents: 'このページの内容', checked: '資料確認', minutes: '分で読める', source: 'この記事の出典', edit: '誤記・改善を報告', prev: '前のガイド', next: '次のガイド', alpha: '公開アルファ', footer: 'キャラも記憶も、きみの手元に。', noResults: '見つかりませんでした。別の言葉で検索してみてください。', loadError: '検索を読み込めませんでした。ガイド一覧から記事を開けます。', results: '件のガイド', copied: 'コピーしました', copy: 'コードをコピー', permalink: '見出しへのリンク', status: '公開状況と対応範囲', sourceNote: '公開GitHubの資料をもとに編集。リンクは確認時のコミットに固定しています。', guide: 'ガイド' },
  en: { home: 'Documentation', search: 'Search the docs', searchHint: 'Search for a task or keyword', close: 'Close', menu: 'Browse guides', theme: 'Switch color theme', contents: 'On this page', checked: 'Sources reviewed', minutes: 'min read', source: 'Sources for this article', edit: 'Report a correction', prev: 'Previous guide', next: 'Next guide', alpha: 'Public alpha', footer: 'Your characters and memories stay yours.', noResults: 'No matches. Try a different search term.', loadError: 'Search could not load. You can open articles from the guide navigation.', results: 'guides', copied: 'Copied', copy: 'Copy code', permalink: 'Link to this heading', status: 'Release status and scope', sourceNote: 'Edited from public GitHub materials. Links are pinned to the reviewed commit.', guide: 'Guide' },
};

if (!/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.repository !== 'ELRdn/Kyalulu') throw new Error('Invalid public source manifest');
if (articles.length !== order.length || new Set(articles.map(a => a.slug)).size !== order.length) throw new Error('Missing or duplicate articles');
for (const article of articles) {
  if (!order.includes(article.slug) || !groups.some(g => g.id === article.group)) throw new Error(`Invalid article: ${article.slug}`);
  if (!article.sources.length || article.sources.some(s => !manifest.files[s])) throw new Error(`Unverified source: ${article.slug}`);
  for (const lang of ['ja', 'en']) {
    if (!answers[article.slug]?.[lang]?.length || answers[article.slug][lang].some(item => typeof item !== 'string' || !item.trim())) throw new Error(`Missing answer summary: ${article.slug}/${lang}`);
    if (!article.title[lang] || !article.description[lang] || !article.sections[lang].length) throw new Error(`Missing translation: ${article.slug}`);
    const ids = article.sections[lang].map(s => s.id);
    if (ids.some(id => !/^[a-z][a-z0-9-]*$/.test(id)) || new Set(ids).size !== ids.length) throw new Error(`Invalid section IDs: ${article.slug}`);
    for (const s of article.sections[lang]) {
      if (/<\s*(script|iframe|style|img|h1|h2)\b|\son[a-z]+\s*=|\sstyle\s*=|(?:javascript|data):/i.test(s.html)) throw new Error(`Unsafe article markup: ${article.slug}/${s.id}`);
    }
  }
  if (article.sections.ja.map(s => s.id).join() !== article.sections.en.map(s => s.id).join()) throw new Error(`Section translation mismatch: ${article.slug}`);
}

function resolveHtml(html, lang) {
  return html.replace(/\{\{doc:([a-z-]+)\}\}/g, (_, slug) => {
    if (slug !== 'index' && !order.includes(slug)) throw new Error(`Broken article reference: ${slug}`);
    return link(lang, slug);
  });
}

function entities(lang) {
  return [
    { '@type': 'Organization', '@id': `${origin}/#contributors`, name: 'Kyalulu contributors', url: origin, sameAs: [`https://github.com/${manifest.repository}`] },
    { '@type': 'WebSite', '@id': `${origin}/#website`, url: origin, name: 'Kyalulu', inLanguage: ['ja', 'en'], publisher: { '@id': `${origin}/#contributors` } },
    { '@type': 'SoftwareApplication', '@id': `${origin}/#software`, name: 'Kyalulu', alternateName: 'キャルル', url: origin, applicationCategory: 'EntertainmentApplication', description: lang === 'ja' ? 'ローカルLLMに接続し、キャラクター・会話・記憶を手元に保存するローカルファーストのオープンソースCharacter AIランタイム。外部モデルAPIにも接続できます。' : 'A local-first, open-source Character AI runtime with local LLM connections and locally stored characters, conversations and memories. External model APIs are optional.', sameAs: [`https://github.com/${manifest.repository}`], softwareHelp: { '@type': 'CreativeWork', url: origin + route(lang) } },
  ];
}

function navigation(lang, slug) {
  return `<a class="nav-home${slug === 'index' ? ' active' : ''}" href="${link(lang, 'index')}" ${slug === 'index' ? 'aria-current="page"' : ''}>${icon('book')}${words[lang].home}</a>${groups.map(group => `<div class="nav-group"><p>${group[lang]}</p>${articles.filter(a => a.group === group.id).map(a => `<a href="${link(lang, a.slug)}"${a.slug === slug ? ' class="active" aria-current="page"' : ''}>${escape(a.title[lang])}</a>`).join('')}</div>`).join('')}`;
}

function shell(lang, slug, title, description, content, toc, schema) {
  const w = words[lang];
  const opposite = lang === 'ja' ? 'en' : 'ja';
  const canonical = `${origin}${route(lang, slug)}`;
  const json = JSON.stringify(schema).replace(/</g, '\\u003c');
  schemaHashes.set(route(lang, slug), `'sha256-${createHash('sha256').update(json).digest('base64')}'`);
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} | Kyalulu Docs</title><meta name="description" content="${escape(description)}">
<meta name="theme-color" content="#faf9f6"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ja" href="${origin}${route('ja', slug)}"><link rel="alternate" hreflang="en" href="${origin}${route('en', slug)}"><link rel="alternate" hreflang="x-default" href="${origin}${route('ja', slug)}">
<meta property="og:type" content="${slug === 'index' ? 'website' : 'article'}"><meta property="og:title" content="${escape(title)} | Kyalulu Docs"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="${lang === 'ja' ? 'ja_JP' : 'en_US'}"><meta property="og:image" content="${origin}/assets/og.png"><meta property="og:image:alt" content="Kyalulu — Local-first Character AI"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/favicon.png"><link rel="stylesheet" href="/docs/assets/docs.css"><script src="/docs/assets/docs.js" defer></script>
<script type="application/ld+json">${json}</script>
</head><body data-language="${lang}" data-search-index="${route(lang)}search-index.json" data-no-results="${escape(w.noResults)}" data-load-error="${escape(w.loadError)}" data-results-label="${escape(w.results)}" data-copy="${escape(w.copy)}" data-copied="${escape(w.copied)}">
<a class="skip-link" href="#main">${lang === 'ja' ? '本文へスキップ' : 'Skip to content'}</a>
<header class="topbar"><a class="brand" href="${lang === 'ja' ? '/' : '/en/'}"><img src="/assets/mascot/face-default.webp" width="34" height="34" alt=""><span>Kyalulu<span class="brand-divider">/</span><span class="brand-docs">docs</span></span></a><div class="header-actions"><button class="search-trigger" data-open-search hidden>${icon('search')}<span>${w.search}</span><kbd>Ctrl K</kbd></button><a class="github-link" href="https://github.com/ELRdn/Kyalulu">GitHub ${icon('arrow')}</a><a class="language" href="${route(opposite, slug)}" hreflang="${opposite}" lang="${opposite}" aria-label="${lang === 'ja' ? 'Read this page in English' : 'このページを日本語で読む'}">${opposite.toUpperCase()}</a><button class="theme-button" data-toggle-theme hidden aria-label="${w.theme}">${icon('moon')}</button></div></header>
<details class="mobile-navigation"><summary>${icon('book')}${w.menu}<span>⌄</span></summary><nav aria-label="${w.menu}">${navigation(lang, slug)}</nav></details>
<div class="docs-layout${slug === 'index' ? ' home-layout' : ''}"><aside class="sidebar"><nav aria-label="${w.menu}">${navigation(lang, slug)}</nav><a class="sidebar-note" href="${link(lang, 'release-status')}"><span class="status-dot"></span>${w.alpha}<span>${lang === 'ja' ? '公開範囲を確認する ↗' : 'Check supported scope ↗'}</span></a></aside><main id="main" tabindex="-1">${content}</main>${toc ? `<aside class="toc"><nav aria-label="${w.contents}"><p>${w.contents}</p>${toc}</nav><a class="toc-help" href="${link(lang, 'troubleshooting')}">${lang === 'ja' ? '困ったときは' : 'Need a hand?'} ${icon('arrow')}</a></aside>` : ''}</div>
<footer class="docs-footer"><a href="${lang === 'ja' ? '/' : '/en/'}">Kyalulu</a><span>${w.footer}</span><a href="${link(lang, 'release-status')}">${w.status}</a><span>© Kyalulu contributors</span></footer>
<dialog id="docs-search" aria-labelledby="search-title"><div class="search-dialog-head"><h2 id="search-title">${w.search}</h2><button data-close-search aria-label="${w.close}">×</button></div><label class="search-input-wrap">${icon('search')}<span class="sr-only">${w.searchHint}</span><input id="docs-search-input" type="search" autocomplete="off" placeholder="${w.searchHint}" aria-controls="search-results"></label><p class="search-status" role="status" aria-live="polite"></p><ul id="search-results" class="search-results"></ul><p class="search-tip">${lang === 'ja' ? '↑ ↓ 選択 · Enter 開く · Esc 閉じる' : '↑ ↓ select · Enter open · Esc close'}</p></dialog>
</body></html>\n`;
}

function breadcrumb(lang, article) {
  const entries = [{ '@type': 'ListItem', position: 1, name: 'Kyalulu', item: origin + (lang === 'ja' ? '/' : '/en/') }, { '@type': 'ListItem', position: 2, name: words[lang].home, item: origin + route(lang) }];
  if (article) entries.push({ '@type': 'ListItem', position: 3, name: article.title[lang], item: origin + route(lang, article.slug) });
  return { '@type': 'BreadcrumbList', itemListElement: entries };
}

function card(lang, article, featured = false) {
  return `<a class="guide-card${featured ? ' featured-card' : ''}" href="${link(lang, article.slug)}"><span class="card-icon">${icon(article.icon)}</span><h3>${escape(article.title[lang])}</h3><p>${escape(article.description[lang])}</p><span class="card-bottom">${article.readingMinutes} ${words[lang].minutes}${icon('arrow')}</span></a>`;
}

function home(lang) {
  const ja = lang === 'ja';
  const title = ja ? 'Kyalulu公式ガイド — ローカルLLM・キャラクターAI・記憶' : 'Kyalulu guides — local LLMs, character AI and memory';
  const description = ja ? 'KyaluluはローカルファーストのオープンソースCharacter AI。ローカルLLM接続、手元に保存する会話・記憶、キャラ移行、スマホPWAの使い方を公開資料に基づいて案内します。' : 'Guides for Kyalulu, a local-first, open-source Character AI runtime: local LLM setup, locally stored conversations and memory, character imports and the mobile PWA.';
  const content = `<section class="docs-hero"><div class="hero-text"><p class="eyebrow"><span class="status-dot"></span>KYALULU DOCUMENTATION</p><h1>${ja ? 'Kyaluluの<br><em>使い方ガイド。</em>' : 'Kyalulu docs.<br><em>Keep going.</em>'}</h1><p class="hero-description">${ja ? 'ローカルファーストのオープンソースCharacter AI。<br>ローカルLLMにつなぎ、キャラ・会話・記憶を手元に保存。導入からスマホでの使い方まで。' : 'Local-first, open-source Character AI.<br>Connect local LLMs and keep characters, conversations and memory on your device. Setup and mobile guides.'}</p><a class="hero-cta" href="${link(lang, 'quickstart')}">${ja ? 'ローカル版をはじめる' : 'Start with the local version'}${icon('arrow')}</a><a class="hero-secondary" href="${link(lang, 'overview')}">${ja ? 'Kyaluluって、どんなもの？' : 'New here? Meet Kyalulu'} ↗</a></div><img class="hero-mascot" src="/assets/mascot/guide.webp" width="560" height="560" alt="${ja ? 'ガイドを案内するKyaluluのマスコット' : 'The Kyalulu mascot guiding you'}" fetchpriority="high"><span class="hero-star star-one" aria-hidden="true">✧</span><span class="hero-star star-two" aria-hidden="true">✦</span></section>
<div class="home-intro"><p>${ja ? 'どこから始めよう？' : 'Find your starting point'}</p><span>${ja ? 'やりたいことから、選んでね。' : 'Pick what you want to do.'}</span></div>
<section class="featured-guides" aria-label="${ja ? 'おすすめの導入ガイド' : 'Recommended starting guides'}">${['quickstart', 'imports', 'mobile'].map(slug => card(lang, articles.find(a => a.slug === slug), true)).join('')}</section>
<aside class="home-release-note"><span class="status-dot"></span><p>${ja ? '<strong>公開アルファのガイドです。</strong> 実装済みの範囲と、検証・正式公開に残る項目を分けて案内します。' : '<strong>Guides for the public alpha.</strong> Implemented features and remaining validation or release requirements are described separately.'}</p><a href="${link(lang, 'release-status')}">${ja ? '対応範囲を見る' : 'Check scope'} ↗</a></aside>
${groups.map(group => `<section class="guide-section" id="${group.id}"><div class="section-heading"><span class="section-icon">${icon(group.icon)}</span><h2>${group[lang]}</h2><span>${articles.filter(a => a.group === group.id).length} ${ja ? 'ガイド' : 'guides'}</span></div><div class="guide-grid">${articles.filter(a => a.group === group.id).map(a => card(lang, a)).join('')}</div></section>`).join('')}
<section class="home-bottom"><div><p class="eyebrow">MADE TO BE YOURS</p><h2>${ja ? 'キャラも、記憶も。<br>わかるところから、少しずつ。' : 'Characters. Memories.<br>One step at a time.'}</h2><p>${ja ? 'つまずいたら確認手順へ。技術的な背景は開発ガイドへ。' : 'Troubleshoot a problem, or explore how the runtime works.'}</p><a href="${link(lang, 'troubleshooting')}">${ja ? '困ったときの確認手順' : 'Open troubleshooting'} ${icon('arrow')}</a></div><img src="/assets/mascot/sit.webp" alt="" width="560" height="560" loading="lazy"></section>`;
  const schema = { '@context': 'https://schema.org', '@graph': [...entities(lang), { '@type': 'CollectionPage', '@id': origin + route(lang), url: origin + route(lang), name: title, description, inLanguage: lang, isPartOf: { '@id': `${origin}/#website` }, about: { '@id': `${origin}/#software` }, hasPart: articles.map(a => ({ '@type': 'TechArticle', '@id': origin + route(lang, a.slug), name: a.title[lang], url: origin + route(lang, a.slug) })) }, breadcrumb(lang)] };
  return shell(lang, 'index', title, description, content, '', schema);
}

function articlePage(lang, article, index) {
  const w = words[lang];
  const group = groups.find(g => g.id === article.group);
  const sections = article.sections[lang];
  const summary = answers[article.slug][lang];
  const summaryTitle = lang === 'ja' ? 'このガイドの要点' : 'At a glance';
  const summaryHtml = `<section class="answer-summary" aria-labelledby="at-a-glance"><h2 id="at-a-glance">${summaryTitle}</h2><ul>${summary.map(item => `<li>${escape(item)}</li>`).join('')}</ul></section>`;
  const schemaArticle = { '@type': 'TechArticle', '@id': origin + route(lang, article.slug), url: origin + route(lang, article.slug), mainEntityOfPage: origin + route(lang, article.slug), headline: article.title[lang], description: article.description[lang], abstract: summary.join(' '), inLanguage: lang, author: { '@id': `${origin}/#contributors` }, publisher: { '@id': `${origin}/#contributors` }, about: { '@id': `${origin}/#software` }, image: `${origin}/assets/og.png`, citation: article.sources.map(s => `https://github.com/${manifest.repository}/blob/${manifest.commit}/${s}`), isPartOf: { '@type': 'CollectionPage', '@id': origin + route(lang) } };
  const graph = [...entities(lang), schemaArticle, breadcrumb(lang, article)];
  if (article.slug === 'faq') graph.push({ '@type': 'FAQPage', mainEntity: sections.map(s => ({ '@type': 'Question', name: s.title, acceptedAnswer: { '@type': 'Answer', text: plain(resolveHtml(s.html, lang)) } })) });
  const issue = new URL('https://github.com/ELRdn/Kyalulu/issues/new');
  issue.searchParams.set('title', `[Docs] ${article.title[lang]}`);
  issue.searchParams.set('body', `${origin}${route(lang, article.slug)}\n\n${lang === 'ja' ? '誤記・改善点：' : 'Correction or suggestion:'}\n`);
  const content = `<nav class="breadcrumbs" aria-label="${lang === 'ja' ? 'パンくずリスト' : 'Breadcrumb'}"><a href="${route(lang)}">${w.home}</a><span aria-hidden="true">/</span><span>${group[lang]}</span></nav><article class="article"><header class="article-header"><p class="eyebrow">${icon(article.icon)}${group[lang]}</p><h1>${escape(article.title[lang])}</h1><p class="article-description">${escape(article.description[lang])}</p><div class="article-meta"><span>${article.readingMinutes} ${w.minutes}</span><span>${w.checked} <time datetime="${manifest.reviewed}">${manifest.reviewed}</time></span><a href="${link(lang, 'release-status')}">${w.alpha} ↗</a></div></header>${summaryHtml}<details class="inline-toc"><summary>${w.contents}</summary><ol><li><a href="#at-a-glance">${summaryTitle}</a></li>${sections.map(s => `<li><a href="#${s.id}">${escape(s.title)}</a></li>`).join('')}</ol></details>${sections.map(s => `<section class="article-section" aria-labelledby="${s.id}"><h2 id="${s.id}">${escape(s.title)}<a class="heading-anchor" href="#${s.id}" aria-label="${w.permalink}: ${escape(s.title)}">#</a></h2>${resolveHtml(s.html, lang)}</section>`).join('')}<section class="article-sources" aria-labelledby="article-sources"><h2 id="article-sources">${w.source}</h2><p>${w.sourceNote}</p><ul>${article.sources.map(s => `<li><a href="https://github.com/${manifest.repository}/blob/${manifest.commit}/${s}">${escape(s)}</a></li>`).join('')}</ul><div class="source-foot"><code>${manifest.commit.slice(0, 7)}</code><a href="${escape(issue)}">${w.edit} ↗</a></div></section></article><nav class="pagination" aria-label="${lang === 'ja' ? '前後のガイド' : 'Adjacent guides'}">${index > 0 ? `<a href="${link(lang, articles[index - 1].slug)}"><span>← ${w.prev}</span><strong>${escape(articles[index - 1].title[lang])}</strong></a>` : '<div></div>'}${index < articles.length - 1 ? `<a href="${link(lang, articles[index + 1].slug)}"><span>${w.next} →</span><strong>${escape(articles[index + 1].title[lang])}</strong></a>` : '<div></div>'}</nav>`;
  const toc = `<a href="#at-a-glance">${summaryTitle}</a>` + sections.map(s => `<a href="#${s.id}">${escape(s.title)}</a>`).join('') + `<a href="#article-sources">${w.source}</a>`;
  return shell(lang, article.slug, article.title[lang], article.description[lang], content, toc, { '@context': 'https://schema.org', '@graph': graph });
}

const schemaHashes = new Map();
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'en', 'style.css', 'main.js', 'assets']) await cp(path.join(landing, file), path.join(output, file), { recursive: true });
await mkdir(path.join(output, 'docs/assets'), { recursive: true });
for (const file of ['docs.css', 'docs.js']) await cp(path.join(landing, 'docs', file), path.join(output, 'docs/assets', file));
const pages = [];
for (const lang of ['ja', 'en']) {
  for (const slug of ['index', ...articles.map(a => a.slug)]) {
    const directory = path.join(output, route(lang, slug));
    await mkdir(directory, { recursive: true });
    const article = articles.find(a => a.slug === slug);
    const html = article ? articlePage(lang, article, articles.indexOf(article)) : home(lang);
    await writeFile(path.join(directory, 'index.html'), html);
    pages.push(route(lang, slug));
  }
  const index = articles.map(a => ({ title: a.title[lang], description: a.description[lang], url: route(lang, a.slug), group: groups.find(g => g.id === a.group)[lang], keywords: a.keywords[lang], sections: [{ title: lang === 'ja' ? 'このガイドの要点' : 'At a glance', id: 'at-a-glance', text: answers[a.slug][lang].join(' ') }, ...a.sections[lang].map(s => ({ title: s.title, id: s.id, text: plain(resolveHtml(s.html, lang)) }))] }));
  await writeFile(path.join(output, route(lang), 'search-index.json'), JSON.stringify(index));
}
const allRoutes = ['/', '/en/', ...pages];
const xmlEscape = escape;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${allRoutes.map(url => {
  const isDocs = url.startsWith('/docs/');
  const slug = isDocs ? url.replace(/^\/docs\/(en\/)?/, '').replace(/\/$/, '') || 'index' : null;
  const altJa = isDocs ? route('ja', slug) : '/';
  const altEn = isDocs ? route('en', slug) : '/en/';
  return `<url><loc>${origin}${url}</loc><xhtml:link rel="alternate" hreflang="ja" href="${origin}${xmlEscape(altJa)}"/><xhtml:link rel="alternate" hreflang="en" href="${origin}${xmlEscape(altEn)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${origin}${xmlEscape(altJa)}"/></url>`;
}).join('\n')}\n</urlset>\n`;
await writeFile(path.join(output, 'sitemap.xml'), sitemap);
await writeFile(path.join(output, 'robots.txt'), `User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
const llms = `# Kyalulu\n\n> Kyalulu (キャルル) is a local-first, open-source Character AI runtime. It stores characters, conversations and memories; a connected model provider generates replies.\n\nThe public documentation is available in Japanese and English. It describes a public alpha, not a guarantee of production readiness. PWA/Remote require an awake PC or personal server. External model APIs receive prompt data. Memory is off by default and does not guarantee perfect recall.\n\nSource repository: https://github.com/${manifest.repository}\nReviewed source commit: ${manifest.commit}\nSource review date: ${manifest.reviewed} (not a fresh physical-device test date).\n\n## Documentation\n\n- [Japanese documentation](${origin}/docs/): Main guide index.\n- [English documentation](${origin}/docs/en/): English guide index.\n${articles.flatMap(a => ['ja', 'en'].map(lang => `- [${a.title[lang]}](${origin}${route(lang, a.slug)}): ${a.description[lang]}`)).join('\n')}\n\n## Optional\n\n- [Full documentation text](${origin}/docs/llms-full.txt): Plain text with visible summaries, sections, canonical URLs and source citations for both languages.\n- [Published source scope](${origin}/docs/en/release-status/): Distinguishes implementation, validation and release acceptance.\n\nThis file is a supplemental reading index, not a search-engine requirement or a guarantee of AI citation.\n`;
await writeFile(path.join(output, 'llms.txt'), llms);
function readable(html, lang) {
  return resolveHtml(html, lang)
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, code) => `\n\n\`\`\`\n${code}\n\`\`\`\n\n`)
    .replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, url, label) => `[${plain(label)}](${url.startsWith('/') ? origin + url : url})`)
    .replace(/<h3[^>]*>/g, '\n\n### ').replace(/<\/h3>/g, '\n\n')
    .replace(/<li[^>]*>/g, '\n- ').replace(/<\/li>/g, '\n')
    .replace(/<tr[^>]*>/g, '\n').replace(/<\/(?:th|td)>/g, ' | ')
    .replace(/<code[^>]*>/g, '`').replace(/<\/code>/g, '`')
    .replace(/<\/(?:p|ol|ul|table|aside)>/g, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
await writeFile(path.join(output, 'docs/llms-full.txt'), `# Kyalulu documentation\n\nPublic source: https://github.com/${manifest.repository}/tree/${manifest.commit}\nReviewed: ${manifest.reviewed}. Implementation is separate from release acceptance. Canonical HTML pages are the primary sources.\n\n${['ja', 'en'].flatMap(lang => articles.map(a => `## ${a.title[lang]}\n\nCanonical: ${origin}${route(lang, a.slug)}\nLanguage: ${lang}\n\n${answers[a.slug][lang].map(text => `- ${text}`).join('\n')}\n\n${a.sections[lang].map(s => `### ${s.title}\n\n${readable(s.html, lang)}`).join('\n\n')}\n\nSources:\n${a.sources.map(s => `- https://github.com/${manifest.repository}/blob/${manifest.commit}/${s}`).join('\n')}`)).join('\n\n---\n\n')}\n`);
await writeFile(path.join(output, '_redirects'), pages.map(p => `${p.slice(0, -1)} ${p} 301\n${p}index.html ${p} 301`).join('\n') + '\n');
const csp = hash => `default-src 'none'; script-src 'self' ${hash}; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'`;
await writeFile(path.join(output, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/docs/*\n  Cache-Control: no-cache\n/docs/assets/*\n  Cache-Control: public, max-age=3600\n/llms.txt\n  Content-Type: text/plain; charset=utf-8\n  X-Robots-Tag: noindex\n/docs/llms-full.txt\n  Content-Type: text/plain; charset=utf-8\n  X-Robots-Tag: noindex\n${[...schemaHashes].map(([url, hash]) => `${url}\n  Content-Security-Policy: ${csp(hash)}`).join('\n')}\n`);
await writeFile(path.join(output, '404.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>ページが見つかりません | Kyalulu</title><link rel="stylesheet" href="/docs/assets/docs.css"></head><body><main class="not-found"><p class="eyebrow">404 · KYALULU</p><h1>ページが見つかりません</h1><p>URLが変わったか、まだ公開されていないページです。</p><a href="/docs/">ドキュメントへ →</a><p lang="en">Page not found. <a href="/docs/en/">Browse the English documentation.</a></p></main></body></html>\n`);
await writeFile(path.join(output, 'docs/build-manifest.json'), JSON.stringify({ origin, sourceCommit: manifest.commit, reviewed: manifest.reviewed, pages, articleCount: articles.length, languages: ['ja', 'en'] }, null, 2) + '\n');
console.log(`Built ${pages.length} docs pages (${articles.length} guides × 2 languages + homepages).`);
console.log(`Public sources: ${manifest.repository}@${manifest.commit.slice(0, 7)} (${manifest.reviewed}).`);
console.log(`Static site ready: ${output}`);
