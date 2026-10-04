(() => {
  const doc = document.documentElement;
  doc.classList.remove('no-js');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Split headings into per-character spans for the staggered reveal. The full text stays as aria-label.
  document.querySelectorAll('.split').forEach((el) => {
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walk = (node) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          // Latin words stay unbreakable; Japanese splits per character (keeping trailing punctuation attached) so it can still wrap.
          const frag = document.createDocumentFragment();
          const ch = (c, parent) => {
            const s = document.createElement('span');
            s.className = 'ch';
            s.textContent = c;
            s.style.setProperty('--i', i++);
            s.setAttribute('aria-hidden', 'true');
            parent.append(s);
          };
          for (const t of n.textContent.trim() ? n.textContent.match(/[A-Za-z0-9'’.,!?$/-]+|\s+|.[、。，．」』）！？]*/gsu) : []) {
            if (/^\s+$/.test(t)) frag.append(' ');
            else if (t.length > 1) {
              const w = document.createElement('span');
              w.className = 'wd';
              for (const c of t) ch(c, w);
              frag.append(w);
            } else ch(t, frag);
          }
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      }
    };
    walk(el);
  });

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.18 });
  document.querySelectorAll('.rv, .split, .chat').forEach((el) => io.observe(el));

  // Scroll-linked motion: nav state, hero screenshot rise, stacked-card depth, marquee skew.
  const nav = document.querySelector('.nav');
  const shot = document.querySelector('.hero-shot');
  const cards = [...document.querySelectorAll('.card')];
  const bands = [...document.querySelectorAll('.band')];
  let lastY = scrollY, skew = 0, ticking = false;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const frame = () => {
    ticking = false;
    const y = scrollY, vh = innerHeight;
    nav.classList.toggle('scrolled', y > 30);
    if (calm) return;
    const r = shot.getBoundingClientRect();
    shot.style.setProperty('--p', clamp((vh - r.top) / (vh * 0.75)).toFixed(3));
    cards.forEach((c, i) => {
      const next = cards[i + 1];
      if (!next || getComputedStyle(c).position !== 'sticky') { c.style.transform = ''; c.style.filter = ''; return; }
      const k = clamp(1 - (next.getBoundingClientRect().top - c.getBoundingClientRect().top) / c.offsetHeight);
      c.style.transform = `scale(${1 - k * 0.05})`;
      c.style.filter = `brightness(${1 - k * k * 0.4})`;
    });
    skew += (Math.max(-12, Math.min(12, (y - lastY) * 0.25)) - skew) * 0.2;
    lastY = y;
    bands.forEach((b) => b.style.setProperty('--skew', `${skew.toFixed(2)}deg`));
    if (Math.abs(skew) > 0.05) request();
  };
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  // A sticky card taller than the viewport sticks with a negative top so its bottom stays reachable.
  const layout = () => {
    for (const c of cards) {
      c.style.top = '';
      const cs = getComputedStyle(c);
      if (cs.position === 'sticky') c.style.top = `${Math.min(parseFloat(cs.top), innerHeight - c.offsetHeight - 16)}px`;
    }
    request();
  };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', layout);
  document.fonts.ready.then(layout);
  layout();

  // Hero stickers drift with the pointer.
  const hero = document.querySelector('.hero');
  if (!calm && matchMedia('(pointer: fine)').matches) {
    const stickers = [...hero.querySelectorAll('[data-depth]')];
    hero.addEventListener('pointermove', (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      for (const s of stickers) { const d = +s.dataset.depth; s.style.translate = `${x * d}px ${y * d}px`; }
    });
  }

  // Waitlist: set data-endpoint on <form> to a POST URL that accepts {email, lang}. Empty = not open yet.
  const form = document.querySelector('#waitlist-form');
  if (!form) return;
  const status = form.querySelector('.status');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = form.dataset;
    const endpoint = form.dataset.endpoint;
    if (!form.email.checkValidity()) { status.textContent = msg.invalid; form.email.focus(); return; }
    if (!form.consent.checked) { status.textContent = msg.consent; form.consent.focus(); return; }
    if (!endpoint) { status.textContent = msg.closed; return; }
    status.textContent = '…';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value, lang: doc.lang }),
      });
      if (!res.ok) throw new Error(res.status);
      form.reset();
      status.textContent = msg.ok;
    } catch {
      status.textContent = msg.error;
    }
  });
})();
