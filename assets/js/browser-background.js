// Safari 26 samples actual page/background painting; theme-color remains a
// fallback for browsers that still honor it. Do not put a fixed color overlay
// over the page: Safari itself supplies the translucent browser UI.
export function initBrowserBackground(intro) {
  const root = document.documentElement;
  const photo = intro.querySelector('.intro-panel-peg img');
  const featured = document.querySelector('.home-featured');
  let frame = 0;
  let previousColor = '';

  function layout() {
    const style = getComputedStyle(intro);
    const height = parseFloat(getComputedStyle(intro, '::after').top);
    const run = Number(style.getPropertyValue('--intro-diagonal-run'));
    const start = Number(style.getPropertyValue('--intro-diagonal-start'));
    const heading = intro.querySelector('.intro-heading');
    const slope = intro.clientWidth * run / height;
    intro.style.setProperty('--intro-slope', slope);
    // Avoid depending on CSS sqrt() support in older Safari versions.
    intro.style.setProperty('--intro-normal', Math.hypot(1, slope));
    if (heading) intro.style.setProperty('--heading-start', `${intro.clientWidth * start + slope * heading.offsetTop}px`);
    if (photo.currentSrc) {
      intro.style.setProperty('--intro-photo-source', `url("${photo.currentSrc}")`);
    }
    schedule();
  }

  function paint() {
    frame = 0;
    const rect = intro.getBoundingClientRect();
    const style = getComputedStyle(intro);
    const fadeStart = parseFloat(getComputedStyle(intro, '::after').top);
    const progress = Math.max(0, Math.min(1, (-rect.top - fadeStart) / (rect.height - fadeStart)));
    // Match the fade's alpha stops, including the solid stretch at its end.
    const stops = [[0, 0], [.22, .2], [.61, .71], [.8, .94], [.92, 1], [1, 1]];
    const end = stops.findIndex(stop => stop[0] >= progress);
    const a = stops[Math.max(0, end - 1)];
    const b = stops[end];
    const alpha = a[0] === b[0] ? b[1] : a[1] + (b[1] - a[1]) * (progress - a[0]) / (b[0] - a[0]);
    const rgb = name => style.getPropertyValue(name).trim().slice(1).match(/../g).map(channel => parseInt(channel, 16));
    const paper = rgb('--feature-paper');
    const blue = rgb('--blue');
    const newsBottom = featured.getBoundingClientRect().bottom;
    const newsFade = getComputedStyle(featured, '::after');
    const fadeHeight = parseFloat(newsFade.height);
    const fadeBottom = parseFloat(newsFade.bottom);
    const whiteAlpha = Math.max(0, Math.min(1, (fadeHeight + fadeBottom - newsBottom) / (fadeHeight * .9)));
    // Numeric sRGB blending also works before Safari gained color-mix().
    const channels = whiteAlpha > 0
      ? paper.map(channel => Math.round(channel + (255 - channel) * whiteAlpha))
      : blue.map((channel, index) => Math.round(channel + (paper[index] - channel) * alpha));
    const color = `rgb(${channels.join(' ')})`;
    if (color === previousColor) return;
    root.style.setProperty('--browser-background', color);
    previousColor = color;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  new ResizeObserver(layout).observe(intro);
  photo.addEventListener('load', layout);
  window.addEventListener('resize', layout, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('pageshow', layout);
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  document.fonts?.ready.then(layout);
  layout();
}
