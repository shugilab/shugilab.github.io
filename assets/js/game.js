// Replace this initializer with the actual game's asset loading and startup.
// Resolve only when it can render and accept input; reject on startup failure.
export async function initGame(host) {
  // Temporary loading preview for the placeholder. Remove when a real game's
  // asset loading and initialization replace this function.
  const previewWait = new Promise(resolve => setTimeout(resolve, 5000));
  if (document.fonts) await document.fonts.ready;
  await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
  await previewWait;
  // The current game is a static placeholder; prepare its first frame.
  await new Promise(resolve => requestAnimationFrame(resolve));
}
