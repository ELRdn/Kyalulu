(() => {
  const doc = document.documentElement;
  doc.classList.remove('no-js');

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.2 });
  document.querySelectorAll('.rv, .chat').forEach((el) => io.observe(el));

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
