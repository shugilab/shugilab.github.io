// Evaluate the sloping edge at the text's real height. Only measured geometry
// is written here; panel gaps, slope, QR size and typography remain in CSS.
export function initContactLayout(region) {
  const intro = region.closest('.home-intro');
  const copy = region.querySelector('.intro-contact-copy');
  const paragraphs = [...copy.querySelectorAll('p')];
  let frame = 0;
  const set = (name, value) => region.style.setProperty(name, `${value}px`);

  function layout() {
    frame = 0;
    const face = region.getBoundingClientRect();
    if (!face.width || !face.height) return;
    for (const p of paragraphs) {
      p.classList.remove('is-distributed');
      p.style.removeProperty('padding-right');
    }
    region.style.removeProperty('--contact-copy-font');
    region.style.removeProperty('--contact-abbr-width');
    // CSS owns the aspect-ratio breakpoint. Hidden copy means the compact
    // navigation/QR layout, so its text need not be measured or justified.
    const showCopy = getComputedStyle(copy).display !== 'none';
    region.setAttribute('aria-label', showCopy ? '活動場所・お問い合わせ' : 'Instagram・お問い合わせ');
    if (!showCopy) return;
    const introStyle = getComputedStyle(intro);
    const reference = Number(introStyle.getPropertyValue('--home-reference-width')) || innerWidth;
    const uiScale = Math.max(1, innerWidth/reference);
    const stageHeight = parseFloat(getComputedStyle(intro, '::after').top);
    const slope = innerWidth * parseFloat(introStyle.getPropertyValue('--intro-diagonal-run')) / stageHeight;
    const padding = parseFloat(getComputedStyle(region.querySelector('.intro-qr-group')).right);
    const gap = parseFloat(getComputedStyle(region.querySelector('.intro-instagram')).rowGap);
    let font = parseFloat(getComputedStyle(copy).fontSize);
    const minimumFont = Math.min(font, 9.5*uiScale);

    function place(top) {
      set('--contact-copy-top', top);
      set('--contact-flow-start', slope * top + padding);
      set('--contact-flow-end', slope * face.height + padding);
      // Continue the guide past the text so a final wrapped line never loses
      // its exclusion shape and jumps back to the rectangular left edge.
      set('--contact-flow-height', face.height - top);
      const height = paragraphs.reduce((sum, p) => sum + p.getBoundingClientRect().height, 0) + gap * (paragraphs.length - 1);
      set('--contact-copy-height', height);
      return { top, height, error: top + height / 2 - face.height / 2 };
    }

    function measureText() {
      const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      const right = copy.getBoundingClientRect().right;
      const rows = [];
      let fits = true;
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const edge = face.left + slope * (rect.bottom - face.top);
          if (rect.left < edge - 1 || rect.right > right + 1 || rect.top < face.top || rect.bottom > face.bottom) fits = false;
          const middle = (rect.top + rect.bottom) / 2;
          let row = rows.find(line => Math.abs(line.middle - middle) < font * .75);
          if (row) row.right = Math.max(row.right, rect.right);
          else rows.push({ middle, right: rect.right });
        }
      }
      return { fits, rows };
    }

    for (let sizePass = 0; sizePass < 50; sizePass++) {
      set('--contact-copy-font', font);
      let low = padding, high = face.height / 2;
      let best = place(low);
      // A lower starting point narrows each line and can only increase the
      // paragraph height. Search for the common text/QR center.
      for (let pass = 0; pass < 22; pass++) {
        const trial = place((low + high) / 2);
        if (Math.abs(trial.error) < Math.abs(best.error)) best = trial;
        if (trial.error > 0) high = trial.top;
        else low = trial.top;
      }
      place(best.top);
      const text = measureText();
      const naturalLines = text.rows.length <= Number(copy.dataset.normalLines || 3);
      if (text.fits && naturalLines && (Math.abs(best.error) < 1 || font <= minimumFont)) break;
      if (font <= minimumFont) break;
      font = Math.max(minimumFont, font - .2*uiScale);
    }
    // First find each item's natural longest line, then justify shorter lines
    // to that same end. Type size stays identical throughout the item.
    {
      const copyRight = copy.getBoundingClientRect().right;
      for (const p of paragraphs.filter(p => p.hasAttribute('data-distribute'))) {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let right = -Infinity;
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) {
            if (rect.width && rect.height) right = Math.max(right, rect.right);
          }
        }
        if (Number.isFinite(right)) {
          p.style.paddingRight = `${Math.max(0, copyRight - right)}px`;
          p.classList.add('is-distributed');
          // Some engines do not distribute a single Latin abbreviation.
          // Its letter flex items use the same measured line end instead.
          const short = p.querySelector('.intro-center-short');
          if (short && getComputedStyle(short).display !== 'none') {
            set('--contact-abbr-width', Math.max(0, right - short.getBoundingClientRect().left));
          }
        }
      }
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
  const observer = new ResizeObserver(schedule);
  observer.observe(region);
  window.addEventListener('resize', schedule, { passive: true });
  document.fonts?.ready.then(schedule);
  layout();
  return { refresh: schedule, dispose() { observer.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame); } };
}
