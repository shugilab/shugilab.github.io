import * as THREE from '../../vendor/three/three.module.js';
import { createActivityModels } from './models.js?v=pages-candidate-20261104-18';
import { pointVertex, pointFragment } from './shaders.js?v=pages-candidate-20261104-18';
import {PARTICLE_STYLE,particleUniforms,createSurfaceDepthPass,particleDisplayScale} from './particle-rendering.js?v=pages-candidate-20261104-18';
import {readParticleSettings,particleCount} from './particle-settings.js?v=pages-candidate-20261104-18';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t*t*(3-2*t); };
// Equal morph budgets concentrate more points on the narrow instruments.
// Composite opacity caps that buildup without changing geometry or brand colors.
const MODEL_OPACITY = [.4, .42, .55];
const CLOUD_OVERSCAN=1.2;

function scatterData(count) {
  const scatter = new Float32Array(count * 3), seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const index = i;
    const hash = n => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value-Math.floor(value); };
    seeds[i] = hash(index + 1);
    scatter[i*3] = (hash(index + 34)-.5)*2.4;
    scatter[i*3+1] = (hash(index + 765)-.5)*1.7;
    scatter[i*3+2] = (hash(index + 1543)-.5)*2.6;
  }
  return { scatter, seeds };
}

function geometryFor(models) {
  const count = models[0].points.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(models[0].points, 3));
  geometry.setAttribute('aTarget1', new THREE.BufferAttribute(models[1].points, 3));
  geometry.setAttribute('aTarget2', new THREE.BufferAttribute(models[2].points, 3));
  for (let i = 0; i < 3; i++) geometry.setAttribute(`aColor${i}`, new THREE.BufferAttribute(models[i].colors, 3));
  for (let i=0;i<3;i++) geometry.setAttribute(`aNormal${i}`,new THREE.BufferAttribute(models[i].normals,3));
  for (let i=0;i<3;i++) geometry.setAttribute(`aFeature${i}`,new THREE.BufferAttribute(models[i].feature,1));
  const { scatter, seeds } = scatterData(count);
  geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geometry;
}

export function initActivityScene(root) {
  const visual = root.querySelector('[data-scene-visual]');
  const news = document.querySelector('.home-featured');
  const chapters = [...root.querySelectorAll('[data-scene-step]')];
  const compactViewport = matchMedia('not all and (min-aspect-ratio: 3/2)');
  const touchViewport = matchMedia('(pointer: coarse)');
  let samplingCompact=compactViewport.matches;
  const settings=readParticleSettings({compact:samplingCompact});
  let models = createActivityModels({ pointCount: particleCount(samplingCompact?6500:6000,settings.density), retainSurfaces:true });
  let depthPass=createSurfaceDepthPass(models.map(model=>model.surfaces));
  models.forEach(model=>{model.surfaces.forEach(surface=>surface.geometry.dispose());delete model.surfaces;});
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 4.2, -4.2, .1, 40);
  camera.position.set(0, 0, 14); camera.lookAt(0, 0, 0);
  const group = new THREE.Group(); scene.add(group);
  const uniforms = {
    ...particleUniforms(),
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uScatterStrength: { value: .12 },
    uGlitchStrength: { value: 0 },
    uPointSize: { value: settings.size },
    uPixelRatio: { value: 1 },
    uViewportWorldSize: {value:new THREE.Vector2(1,1)},
  };
  let pointGeometry = geometryFor(models);
  const pointMaterial = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uOpacity: { value: 1 } },
    vertexShader: pointVertex, fragmentShader: pointFragment,
    transparent: true, blending:THREE.NormalBlending, depthWrite: false, depthTest: true, toneMapped: false,
  });
  const points = new THREE.Points(pointGeometry, pointMaterial);
  points.frustumCulled = false;
  group.add(points);

  let renderer, fallback, canvas, width = 1, height = 1, ratio = 1;
  let current = 0, target = 0, raf = 0, previous = 0, visible = true, destroyed = false;
  let scrollCurrent = 0, scrollTarget = 0, rotationTime = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let anchors = [], active = -1, frames = 0;
  const abort = new AbortController();

  function useCanvasFallback() {
    if (fallback) return;
    const replacement = document.createElement('canvas');
    replacement.setAttribute('aria-hidden', 'true');
    if (canvas) canvas.replaceWith(replacement); else visual.prepend(replacement);
    canvas = replacement; fallback = canvas.getContext('2d');
    renderer?.dispose(); renderer = null;
    root.dataset.renderer = 'canvas2d';
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    renderer.setClearColor('#ffffff', 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvas = renderer.domElement; canvas.setAttribute('aria-hidden', 'true'); visual.prepend(canvas);
    root.dataset.renderer = 'webgl';
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); useCanvasFallback(); resize();
    }, { signal: abort.signal });
  } catch {
    useCanvasFallback();
  }

  // The canvas fallback uses the same targets and trajectory, so unsupported GPUs
  // still show the three silhouettes and reversible scroll transitions.
  const projection = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const scratch = new Float32Array(8);
  const blue=new THREE.Color(PARTICLE_STYLE.blue),pink=new THREE.Color(PARTICLE_STYLE.pink);
  const fallbackColors=Array.from({length:9},(_,i)=>blue.clone().lerp(pink,i/8).getStyle());
  function cpuPosition(geometry, index) {
    const stage = Math.min(1, Math.floor(Math.max(0, current))), t = clamp(current-stage), blend = smooth(t);
    const dissolve = Math.sin(t*Math.PI)**2;
    const arrival = 1-smooth(current+1);
    const from = geometry.getAttribute(stage ? 'aTarget1' : 'position').array;
    const to = geometry.getAttribute(stage ? 'aTarget2' : 'aTarget1').array;
    const scatter = geometry.getAttribute('aScatter').array;
    const seed = geometry.getAttribute('aSeed').array[index], offset = index*3;
    const angle = t*2.4 + seed*Math.PI*2, cos = Math.cos(angle), sin = Math.sin(angle);
    const sx=cos*scatter[offset]+sin*scatter[offset+2],sy=scatter[offset+1],sz=-sin*scatter[offset]+cos*scatter[offset+2];
    let x = from[offset] + (to[offset]-from[offset])*blend + sx*dissolve*uniforms.uScatterStrength.value;
    let y = from[offset+1] + (to[offset+1]-from[offset+1])*blend + sy*dissolve*uniforms.uScatterStrength.value;
    let z = from[offset+2] + (to[offset+2]-from[offset+2])*blend + sz*dissolve*uniforms.uScatterStrength.value;
    const normalsA = geometry.getAttribute(`aNormal${stage}`).array;
    const normalsB = geometry.getAttribute(`aNormal${stage+1}`).array;
    const nx=normalsA[offset]+(normalsB[offset]-normalsA[offset])*blend;
    const ny=normalsA[offset+1]+(normalsB[offset+1]-normalsA[offset+1])*blend;
    const nz=normalsA[offset+2]+(normalsB[offset+2]-normalsA[offset+2])*blend;
    const jitter=Math.sin(uniforms.uTime.value*.7+seed*Math.PI*2)*uniforms.uJitterAmplitude.value*(1-Math.max(dissolve,arrival))/Math.max(.0001,Math.hypot(nx,ny,nz));
    x+=nx*jitter;y+=ny*jitter;z+=nz*jitter;
    const m = projection.elements;
    const w = m[3]*x+m[7]*y+m[11]*z+m[15];
    scratch[0] = ((m[0]*x+m[4]*y+m[8]*z+m[12])/w*.5+.5)*width;
    scratch[1] = (-(m[1]*x+m[5]*y+m[9]*z+m[13])/w*.5+.5)*height;
    scratch[2] = (m[2]*x+m[6]*y+m[10]*z+m[14])/w*.5+.5;
    const c=camera.matrixWorldInverse.elements,g=group.matrixWorld.elements;
    const center=c[2]*g[12]+c[6]*g[13]+c[10]*g[14]+c[14];
    const cloudDepth=(camera.projectionMatrix.elements[10]*(center+scatter[offset+2])+camera.projectionMatrix.elements[14])*.5+.5;
    scratch[0]=scratch[0]*(1-arrival)+(scatter[offset]/2.4*CLOUD_OVERSCAN+.5)*width*arrival;
    scratch[1]=scratch[1]*(1-arrival)+(.5-scatter[offset+1]/1.7*CLOUD_OVERSCAN)*height*arrival;
    scratch[2]=scratch[2]*(1-arrival)+cloudDepth*arrival;
    const n=normalMatrix.elements;
    const vx=n[0]*nx+n[3]*ny+n[6]*nz,vy=n[1]*nx+n[4]*ny+n[7]*nz,vz=n[2]*nx+n[5]*ny+n[8]*nz;
    scratch[3]=vz/Math.max(.0001,Math.hypot(vx,vy,vz));
    const featuresA=geometry.getAttribute(`aFeature${stage}`).array,featuresB=geometry.getAttribute(`aFeature${stage+1}`).array;
    scratch[4]=featuresA[index]+(featuresB[index]-featuresA[index])*blend;
    const colorsA=geometry.getAttribute(`aColor${stage}`).array,colorsB=geometry.getAttribute(`aColor${stage+1}`).array;
    scratch[5]=(colorsA[offset]+(colorsB[offset]-colorsA[offset])*blend-blue.r)/(pink.r-blue.r);
    const viewZ=group.matrixWorld.elements[2]*x+group.matrixWorld.elements[6]*y+group.matrixWorld.elements[10]*z;
    scratch[6]=clamp(.5+(viewZ*(1-arrival)+scatter[offset+2]*arrival)/uniforms.uDepthSpan.value);
    scratch[7]=Math.max(dissolve,arrival);
    return scratch;
  }

  function drawFallback() {
    fallback.setTransform(ratio, 0, 0, ratio, 0, 0);
    fallback.globalAlpha = 1; fallback.clearRect(0, 0, width, height);
    group.updateMatrixWorld(); camera.updateMatrixWorld();
    projection.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(group.matrixWorld);
    normalMatrix.getNormalMatrix(group.matrixWorld);
    const strength=uniforms.uMaskStrength.value;
    const mask=strength>.001?depthPass.softwareMask(camera,group,Math.max(0,Math.min(2,Math.round(current))),width,height):null;
    const levels=fallbackColors.length,alphas=4,paths=Array.from({length:levels*alphas},()=>new Path2D());
    for (let i = 0; i < pointGeometry.getAttribute('position').count; i += 2) {
      const p = cpuPosition(pointGeometry, i);
      if(p[0]<0||p[1]<0||p[0]>=width||p[1]>=height)continue;
      const hidden=mask&&p[2]>mask.data[Math.floor(p[1]/height*mask.height)*mask.width+Math.floor(p[0]/width*mask.width)]+.016/(camera.far-camera.near);
      const rim=Math.max(Math.pow(1-clamp(p[3]),1.7),p[4]*.6);
      const visibility=(1-strength+strength*(hidden?0:smooth((p[3]+.012)/.037)))*(.85+.15*rim)*((.70+.30*p[6])*(1-p[7])+p[7]);
      if(visibility<.05)continue;
      const shade=Math.round(clamp(p[5])*(levels-1));
      const path = paths[shade*alphas+Math.min(alphas-1,Math.floor(visibility*alphas))];
      const radius=uniforms.uPointSize.value*uniforms.uPointScale.value*(.85+.27*p[4])*.43*((.88+.24*p[6])*(1-p[7])+p[7]);
      path.moveTo(p[0]+radius,p[1]); path.arc(p[0],p[1],radius,0,Math.PI*2);
    }
    for(let shade=0;shade<levels;shade++)for(let alpha=0;alpha<alphas;alpha++){
      fallback.globalAlpha=uniforms.uOpacity.value*(alpha+1)/alphas;
      fallback.fillStyle=fallbackColors[shade];
      fallback.fill(paths[shade*alphas+alpha]);
    }
    fallback.globalAlpha = 1;
  }

  function readScroll() {
    const position = scrollY + innerHeight * .5;
    // -1 is a free particle cloud; 0 is the assembled first instrument.
    // Start following as the section enters, then focus at its first anchor.
    let progress = Math.max(-1, Math.min(0, (position-anchors[0])/(innerHeight*.85)));
    let rotation = progress;
    for (let i = 0; i < anchors.length-1; i++) {
      if (position >= anchors[i]) {
        const t = clamp((position-anchors[i])/(anchors[i+1]-anchors[i]));
        progress = i + smooth((t-.2)/.6);
        rotation = i + t;
      }
    }
    target = Math.max(-1, Math.min(2, progress)); scrollTarget = rotation;
    const bounds = root.getBoundingClientRect();
    const top = clamp((news || root).getBoundingClientRect().top/height)*height;
    // Safari's floating controls may clip fixed layers before their CSS
    // extent. Fade inside the visible viewport rather than trying to draw
    // through browser chrome. Keep the small-viewport canvas size stable.
    const viewport=window.visualViewport;
    const visibleBottom=viewport&&Math.abs(viewport.scale-1)<.01
      ?viewport.offsetTop+viewport.height:innerHeight;
    const end=Math.min(height,bounds.bottom,visibleBottom);
    const bottom=clamp((height-end)/height)*height;
    visual.style.clipPath = `inset(${top}px 0 ${bottom}px 0)`;
    const available=Math.max(0,height-top-bottom);
    const edgeFade=Math.min(72,available/3);
    const browserFade=touchViewport.matches?Math.min(104,Math.max(72,(end-top)*.14)):0;
    const bottomFade=Math.min(available/3,Math.max(bottom>0?edgeFade:0,browserFade));
    visual.style.setProperty('--scene-clip-top', `${top}px`);
    visual.style.setProperty('--scene-clip-bottom', `${bottom}px`);
    visual.style.setProperty('--scene-fade-top', `${top > 0 ? edgeFade : 0}px`);
    visual.style.setProperty('--scene-fade-bottom', `${bottomFade}px`);
    schedule();
  }

  function resize() {
    if(samplingCompact!==compactViewport.matches) {
      samplingCompact=compactViewport.matches;
      const nextModels=createActivityModels({pointCount:particleCount(samplingCompact?6500:6000,settings.density),retainSurfaces:true});
      depthPass.dispose();depthPass=createSurfaceDepthPass(nextModels.map(model=>model.surfaces));
      nextModels.forEach(model=>{model.surfaces.forEach(surface=>surface.geometry.dispose());delete model.surfaces;});
      models=nextModels;pointGeometry.dispose();pointGeometry=geometryFor(models);points.geometry=pointGeometry;
    }
    const rect = visual.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    ratio = Math.min(devicePixelRatio || 1, 1.75, Math.sqrt(2200000/(width*height)));
    if (renderer) { renderer.setPixelRatio(ratio); renderer.setSize(width, height, false); }
    else { canvas.width = Math.round(width*ratio); canvas.height = Math.round(height*ratio); }
    uniforms.uPixelRatio.value = ratio;
    const halfHeight = 4.2, worldWidth = halfHeight*2*width/height;
    camera.left = -worldWidth/2; camera.right = worldWidth/2;
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
    uniforms.uViewportWorldSize.value.set(worldWidth*CLOUD_OVERSCAN,halfHeight*2*CLOUD_OVERSCAN);
    const mobile = width < 720;
    const centered = compactViewport.matches;
    group.scale.setScalar(mobile ? Math.min(.85,worldWidth*.96/7.1) : Math.min(1,worldWidth*.53/7.1));
    group.position.set(centered ? 0 : worldWidth*.215, mobile ? -1.3 : .16, 0);
    uniforms.uPointScale.value=particleDisplayScale(6.15*group.scale.x*height/(camera.top-camera.bottom),{compact:compactViewport.matches});
    uniforms.uDepthSpan.value=6.15*group.scale.x;
    const natural = chapters.map(chapter => { const r = chapter.getBoundingClientRect(); return r.top+scrollY+r.height/2; });
    const first = natural[0], last = natural.at(-1);
    // Content-sized chapters may fit in less than a tall viewport. Compress
    // their scroll anchors so the last shape still completes before the page
    // ends, without adding empty space after the introductions.
    const maxScroll = Math.max(0, document.documentElement.scrollHeight-innerHeight);
    const end = Math.min(last, maxScroll+innerHeight*.5);
    const start = end > first ? first : end-Math.max(1,last-first);
    anchors = natural.map(position => start+(position-first)/Math.max(1,last-first)*Math.max(1,end-start));
    readScroll(); draw();
  }

  function draw() {
    uniforms.uProgress.value = current;
    // A free cloud is centered on every screen. Only the first assembly moves
    // it into the right-hand desktop composition; later morphs stay there.
    group.position.x=compactViewport.matches?0:(camera.right-camera.left)*.215*smooth(current+1);
    const stage=Math.min(1,Math.floor(Math.max(0,current))), blend=smooth(current-stage);
    canvas.style.opacity=String(MODEL_OPACITY[stage]+(MODEL_OPACITY[stage+1]-MODEL_OPACITY[stage])*blend);
    // Bounded idle rotation reveals thickness without leaving thin instruments
    // edge-on. A larger turn happens while the shape dissolves on scroll.
    const dissolve = Math.sin(current*Math.PI)**2;
    // Look down into the console, rather than across its horizontal shelves.
    // Keep a three-quarter view even at the extremes of the idle rotation.
    const consoleView = smooth(current-1);
    const pitch = compactViewport.matches ? .38 : .28;
    const yaw = compactViewport.matches ? -.58 : -.48;
    group.rotation.set(
      -.12 + (pitch+.12)*consoleView + Math.sin(rotationTime*.19)*(.09-.045*consoleView) + Math.sin(scrollCurrent*Math.PI)*.08,
      -.22 + (yaw+.22)*consoleView + Math.sin(rotationTime*.27)*(.34-.24*consoleView) + Math.sin(scrollCurrent*Math.PI)*.44 + dissolve*Math.PI*1.4,
      Math.sin(rotationTime*.16)*.025 + Math.sin(scrollCurrent*Math.PI)*.035,
    );
    const scattered=Math.max(dissolve,1-smooth(current+1));
    uniforms.uMaskStrength.value=1-smooth((scattered-.01)/.18);
    if (renderer) {
      if(uniforms.uMaskStrength.value>.001)depthPass.render(renderer,camera,group,Math.max(0,Math.min(2,Math.round(current))),uniforms);
      renderer.render(scene, camera);
    } else drawFallback();
    frames++;
    const step = Math.max(0,Math.min(2,Math.round(current)));
    if (step !== active) {
      active = step; root.dataset.activeStep = String(step);
      chapters.forEach((chapter,i) => chapter.classList.toggle('is-active',i === step));
    }
    root.dataset.progress = current.toFixed(4);
  }

  function frame(now) {
    raf = 0;
    if (destroyed || document.hidden || !visible) return;
    // Software fallback stays at 30 fps while preserving the elapsed-time speed.
    if (fallback && previous && now-previous < 1000/30-1) { schedule(); return; }
    const dt = Math.min(.1, previous ? (now-previous)/1000 : 1/60); previous = now;
    current += (target-current)*(1-Math.exp(-dt*12));
    scrollCurrent += (scrollTarget-scrollCurrent)*(1-Math.exp(-dt*12));
    if (Math.abs(target-current) < .0001) current = target;
    if (Math.abs(scrollTarget-scrollCurrent) < .0001) scrollCurrent = scrollTarget;
    if (!reducedMotion.matches) rotationTime += dt;
    uniforms.uTime.value = now/1000; draw();
    if (current !== target || scrollCurrent !== scrollTarget || uniforms.uGlitchStrength.value > 0 || (!reducedMotion.matches)) schedule();
  }

  function schedule() {
    if (!raf && !destroyed && !document.hidden && visible) raf = requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(resize); observer.observe(visual);
  const visibleSections = new Set();
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleSections.add(entry.target);
      else visibleSections.delete(entry.target);
    }
    visible = visibleSections.size > 0;
    if (visible) { previous = 0; readScroll(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  });
  intersection.observe(root);
  if (news) intersection.observe(news);
  window.addEventListener('scroll', readScroll, { passive: true, signal: abort.signal });
  window.addEventListener('resize', resize, { passive: true, signal: abort.signal });
  window.visualViewport?.addEventListener('resize',readScroll,{passive:true,signal:abort.signal});
  window.visualViewport?.addEventListener('scroll',readScroll,{passive:true,signal:abort.signal});
  touchViewport.addEventListener('change',readScroll,{signal:abort.signal});
  // HOME no longer waits behind a loader; remeasure chapter anchors if the
  // Japanese web font changes their height after the scene initializes.
  document.fonts?.ready.then(() => { if (!destroyed) resize(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { previous=0;readScroll(); } }, { signal: abort.signal });
  reducedMotion.addEventListener('change',()=>{previous=0;schedule();},{signal:abort.signal});
  resize(); current = target; scrollCurrent = scrollTarget; draw();
  root.dataset.sceneState = 'ready';
  root.querySelector('[data-scene-fallback]').hidden = true;

  return {
    dispose() {
      destroyed = true; cancelAnimationFrame(raf); abort.abort(); observer.disconnect(); intersection.disconnect();
      pointGeometry.dispose(); pointMaterial.dispose(); depthPass.dispose(); renderer?.dispose(); canvas.remove();
    },
  };
}
