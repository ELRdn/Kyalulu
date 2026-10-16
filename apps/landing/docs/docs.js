/* Progressive enhancements. Navigation and article content work without JS. */
(() => {
  'use strict';
  const body = document.body;
  const root = document.documentElement;
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let explicitTheme = null;
  try { explicitTheme = localStorage.getItem('kyalulu-docs-theme'); } catch { /* Storage is optional. */ }
  function setTheme(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#18161e' : '#faf9f6');
  }
  setTheme(explicitTheme === 'light' || explicitTheme === 'dark' ? explicitTheme : dark.matches ? 'dark' : 'light');
  const themeButton = document.querySelector('[data-toggle-theme]');
  themeButton.hidden = false;
  themeButton.addEventListener('click', () => {
    explicitTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(explicitTheme);
    try { localStorage.setItem('kyalulu-docs-theme', explicitTheme); } catch { /* Keep working without storage. */ }
  });
  dark.addEventListener('change', () => { if (!explicitTheme) setTheme(dark.matches ? 'dark' : 'light'); });

  const dialog = document.querySelector('#docs-search');
  const trigger = document.querySelector('[data-open-search]');
  const input = document.querySelector('#docs-search-input');
  const results = document.querySelector('#search-results');
  const status = dialog.querySelector('.search-status');
  let searchData = null;
  let loading = null;
  let activeResult = -1;
  let lastFocused = null;
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  function choose(index) {
    const anchors = Array.from(results.querySelectorAll('a'));
    activeResult = anchors.length ? (index + anchors.length) % anchors.length : -1;
    anchors.forEach((anchor, i) => anchor.classList.toggle('selected', i === activeResult));
    anchors[activeResult]?.scrollIntoView({ block: 'nearest' });
  }
  function render() {
    if (!searchData) return;
    const query = normalize(input.value);
    const tokens = query.split(' ').filter(Boolean);
    const ranked = searchData.map(article => {
      const title = normalize(article.title);
      const metadata = normalize(`${article.description} ${article.keywords.join(' ')} ${article.group}`);
      const sectionText = article.sections.map(section => normalize(`${section.title} ${section.text}`));
      const full = `${title} ${metadata} ${sectionText.join(' ')}`;
      if (tokens.some(token => !full.includes(token))) return null;
      let score = tokens.reduce((sum, token) => sum + (title.includes(token) ? 20 : metadata.includes(token) ? 8 : 1), 0);
      if (query && title.includes(query)) score += 30;
      const section = query ? article.sections.find((section, i) => tokens.every(token => sectionText[i].includes(token))) : null;
      return { article, score, section };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12);
    results.replaceChildren();
    for (const { article, section } of ranked) {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = article.url + (section ? `#${section.id}` : '');
      const group = document.createElement('small');
      group.textContent = article.group;
      const title = document.createElement('strong');
      title.textContent = article.title;
      const description = document.createElement('p');
      description.textContent = section ? `${section.title} — ${section.text.slice(0, 95)}…` : article.description;
      anchor.append(group, title, description);
      item.append(anchor);
      results.append(item);
    }
    activeResult = -1;
    status.textContent = ranked.length ? `${ranked.length} ${body.dataset.resultsLabel}` : body.dataset.noResults;
  }
  async function openSearch() {
    if (dialog.open) { input.focus(); return; }
    lastFocused = document.activeElement;
    dialog.showModal();
    input.focus();
    if (searchData) { render(); return; }
    status.textContent = body.dataset.language === 'ja' ? '検索を読み込み中…' : 'Loading search…';
    try {
      if (!loading) loading = fetch(body.dataset.searchIndex).then(response => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      });
      searchData = await loading;
      render();
    } catch {
      loading = null;
      status.textContent = body.dataset.loadError;
    }
  }
  trigger.hidden = false;
  trigger.addEventListener('click', openSearch);
  document.querySelector('[data-close-search]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => lastFocused?.focus());
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
  });
  input.addEventListener('input', event => { if (!event.isComposing) render(); });
  input.addEventListener('compositionend', render);
  dialog.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      // Search inputs can consume the first Escape to clear text; close explicitly.
      event.preventDefault();
      dialog.close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      choose(activeResult + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && document.activeElement === input) {
      const anchor = results.querySelectorAll('a')[Math.max(0, activeResult)];
      if (anchor) { event.preventDefault(); anchor.click(); }
    }
  });
  document.addEventListener('keydown', event => {
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
  });

  for (const pre of document.querySelectorAll('.article-section pre')) {
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.type = 'button';
    button.textContent = body.dataset.copy;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        button.textContent = body.dataset.copied;
        setTimeout(() => { button.textContent = body.dataset.copy; }, 1600);
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pre);
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = body.dataset.language === 'ja' ? '選択しました。Ctrl/Cmd+Cでコピー' : 'Selected. Press Ctrl/Cmd+C';
      }
    });
    toolbar.append(button);
    pre.before(toolbar);
  }
  for (const table of document.querySelectorAll('.article-section table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrap';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    const heading = table.closest('.article-section')?.querySelector('h2');
    wrapper.setAttribute('aria-label', (heading?.textContent.replace(/#$/, '') || '') + (body.dataset.language === 'ja' ? 'の表（横にスクロールできます）' : ' table (scroll horizontally)'));
    table.before(wrapper);
    wrapper.append(table);
  }
  const tocAnchors = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
  if ('IntersectionObserver' in window && tocAnchors.length) {
    const visible = new Map();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
      const current = tocAnchors.find(anchor => visible.get(anchor.hash.slice(1)));
      if (current) tocAnchors.forEach(anchor => anchor.classList.toggle('current', anchor === current));
    }, { rootMargin: '-100px 0px -55% 0px' });
    for (const anchor of tocAnchors) {
      const heading = document.getElementById(anchor.hash.slice(1));
      if (heading) observer.observe(heading);
    }
  }
})();
