const root = document.getElementById('loader');
const page = document.getElementById('page');
const gamePage = document.body.hasAttribute('data-game-page');
const revision = new URL(import.meta.url).searchParams.get('v');
let loader;
let restored = false;

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

// The ribbon animation belongs to game pages only. Entering a game, including
// from HOME or the game list, plays it; history restoration resumes the page.
function shouldAutoPlay() {
  if (!gamePage) return false;
  const navigation = performance.getEntriesByType('navigation')[0];
  return navigation?.type !== 'back_forward';
}

function finishWithoutAnimation() {
  root.hidden = true;
  page.inert = false;
  page.setAttribute('aria-busy', 'false');
  root.querySelector('[aria-live]').textContent = '読み込みが完了しました。';
  window.dispatchEvent(new CustomEvent('shugilab:ready'));
}

async function startLoader() {
  root.hidden = false;
  page.inert = true;
  page.setAttribute('aria-busy', 'true');

  try {
    const [{ RibbonLoader }, response] = await Promise.all([
      import(assetUrl('./loader.js')),
      fetch(assetUrl('../images/shugilab_mark.svg')),
    ]);
    if (!response.ok) throw new Error(`Logo request failed: ${response.status}`);
    const markSvg = await response.text();
    if (restored) return;

    loader = new RibbonLoader({ root, page, markSvg });



    const loaded = document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    await loader.play({ ready: Promise.all([loaded, fonts]) });
  } catch (error) {
    // Content stays available even if the animation or logo cannot load.
    if (loader) loader.dismiss();
    else finishWithoutAnimation();
    console.error('ShugiLab loader failed:', error);
  }
}

if (root && page) {
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    restored = true;
    if (loader) loader.dismiss();
    else finishWithoutAnimation();
  });

  if (gamePage && shouldAutoPlay()) startLoader();
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
