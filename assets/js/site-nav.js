// A compact disclosure below 3:2; otherwise the original navigation stays visible.
export function initSiteNavigation(header) {
  const toggle = header.querySelector('.menu-toggle');
  const nav = header.querySelector('nav');
  const compact = matchMedia('not all and (min-aspect-ratio: 3/2)');
  let open = false;

  function update() {
    const expanded = compact.matches && open;
    nav.hidden = compact.matches && !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'メニューを閉じる' : 'メニューを開く');
    if (expanded) {
      const available = Math.max(0, innerHeight - header.getBoundingClientRect().bottom - 24);
      nav.style.setProperty('--menu-available-height', `${available}px`);
    }
  }

  function close(restoreFocus = false) {
    if (!open) return;
    open = false;
    update();
    if (restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => { open = !open; update(); });
  toggle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open = true;
    update();
    nav.querySelector(event.key === 'ArrowDown' ? 'a:first-child' : 'a:last-child')?.focus();
  });
  nav.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  document.addEventListener('pointerdown', event => { if (!header.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (!header.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); }
  });
  compact.addEventListener('change', () => {
    const focused = document.activeElement;
    open = false;
    update();
    if (compact.matches && nav.contains(focused)) toggle.focus();
    else if (!compact.matches && focused === toggle) nav.querySelector('[aria-current="page"], a')?.focus();
  });
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('pageshow', () => close());
  header.dataset.menuReady = '';
  toggle.hidden = false;
  update();
}
