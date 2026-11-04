const root = document.getElementById('loader');
const gameHost = document.querySelector('[data-game-host]');
const page = gameHost?.querySelector('[data-game-content]') || document.getElementById('page');
const gamePage = document.body.hasAttribute('data-game-page');
const revision = new URL(import.meta.url).searchParams.get('v');
let loader;

// Share the HTML's revision with imported assets so cached modules update together.
function assetUrl(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  if (revision) url.searchParams.set('v', revision);
  return url.href;
}

const siteMenu = document.querySelector('.site-header-menu');
if (siteMenu) {
  import(assetUrl('./site-nav.js'))
    .then(({ initSiteNavigation }) => initSiteNavigation(siteMenu))
    .catch(error => console.error('メニューの操作を初期化できませんでした。', error));
}

function finishWithoutAnimation() {
  root.hidden = true;
  page.inert = false;
  page.setAttribute('aria-busy', 'false');
  root.querySelector('[aria-live]').textContent = '読み込みが完了しました。';
  window.dispatchEvent(new CustomEvent('shugilab:ready'));
}

async function prepareGame() {
  const host = document.querySelector('[data-game-host]');
  try {
    if (!host) throw new Error('Game container is missing.');
    host.dataset.gameState = 'loading';
    host.setAttribute('aria-busy', 'true');
    const { initGame } = await import(assetUrl('./game.js'));
    await initGame(page);
    host.dataset.gameState = 'ready';
    host.dispatchEvent(new CustomEvent('shugilab:game-ready', { bubbles: true }));
  } catch (error) {
    // Resolve only after the error view is usable, so a failed game cannot leave
    // an endless loading screen or reveal a partially initialized application.
    console.error('ゲームを読み込めませんでした。', error);
    if (host) {
      host.dataset.gameState = 'error';
      const message = document.createElement('p');
      message.textContent = 'ゲームを読み込めませんでした。';
      const retry = document.createElement('a');
      retry.href = location.href;
      retry.textContent = '再読み込み';
      page.replaceChildren(message, retry);
    }
  } finally {
    host?.setAttribute('aria-busy', 'false');
  }
}

async function startLoader(ready) {
  root.hidden = false;
  page.inert = true;
  page.setAttribute('aria-busy', 'true');
  let isReady = false;
  ready.then(() => {
    isReady = true;
    // Fast initialization does not wait for animation assets or a minimum intro.
    if (!loader) finishWithoutAnimation();
  });

  try {
    const [{ RibbonLoader }, response] = await Promise.all([
      import(assetUrl('./loader.js')),
      fetch(assetUrl('../images/shugilab_mark.svg')),
    ]);
    if (!response.ok) throw new Error(`Logo request failed: ${response.status}`);
    const markSvg = await response.text();
    if (isReady) return;

    loader = new RibbonLoader({ root, page, markSvg });



    await loader.play({ ready, minimumDuration: 0 });
  } catch (error) {
    // Even if animation assets fail, keep the loading screen until the game (or
    // its error view) is ready. A missing logo must not skip game initialization.
    console.error('ShugiLab loader failed:', error);
    await ready;
    if (loader) loader.dismiss();
    else finishWithoutAnimation();
  }
}

if (root && page) {
  // This is the game's loading lifecycle, inside its host. No link interception
  // or navigation-type playback; a bfcache restoration simply keeps its state.
  if (gamePage) startLoader(prepareGame());
  else finishWithoutAnimation();
}

const intro = document.querySelector('.home-intro');
if (intro) {
  import(assetUrl('./browser-background.js'))
    .then(({ initBrowserBackground }) => initBrowserBackground(intro))
    .catch(error => console.error('背景の配置を調整できませんでした。', error));
}
const contact = document.querySelector('.intro-contact-region');
if (contact) {
  import(assetUrl('./home-contact.js'))
    .then(({ initContactLayout }) => initContactLayout(contact))
    .catch(error => console.error('案内の配置を調整できませんでした。', error));
}

const activityScene = document.querySelector('[data-activity-scene]');
if (activityScene) {
  // HOME starts its background scene immediately, without a loading screen.
  const sceneModule = import(assetUrl('./activity/scene.js'));
  const showSceneError = error => {
    activityScene.dataset.sceneState = 'error';
    activityScene.querySelector('[data-scene-fallback]').hidden = false;
    console.error('ShugiLab 3D scene failed:', error);
  };
  sceneModule.catch(showSceneError);
  let initialized = false;
  const startScene = async () => {
    if (initialized) return;
    initialized = true;
    try {
      const { initActivityScene } = await sceneModule;
      initActivityScene(activityScene);
    } catch (error) {
      showSceneError(error);
    }
  };
  if (!root || root.hidden) startScene();
  else window.addEventListener('shugilab:ready', startScene, { once: true });
}
