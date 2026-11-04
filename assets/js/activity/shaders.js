import {surfacePointFragment} from './particle-rendering.js?v=pages-candidate-20261104-18';

// Particle position function. New GLSL effects belong here.
// uGlitchStrength is intentionally zero until an effect is requested.
export const morph = /* glsl */`
  uniform float uProgress;
  uniform float uTime;
  uniform float uScatterStrength;
  uniform float uGlitchStrength;
  attribute vec3 aTarget1;
  attribute vec3 aTarget2;
  attribute vec3 aColor0;
  attribute vec3 aColor1;
  attribute vec3 aColor2;
  attribute vec3 aScatter;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vScatter;
  varying float vDepth;

  vec3 morphPosition() {
    float stage = step(1.0, uProgress);
    float t = clamp(uProgress - stage, 0.0, 1.0);
    float blend = t*t*(3.0-2.0*t);
    float dissolve = pow(sin(t * 3.14159265359), 2.0);
    float arrival = 1.0 - smoothstep(-1.0, 0.0, uProgress);
    vec3 from = mix(position, aTarget1, stage);
    vec3 to = mix(aTarget1, aTarget2, stage);
    vec3 p = mix(from, to, blend);
    vec3 scatter = aScatter;
    float angle = t * 2.4 + aSeed * 6.2831853;
    scatter.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * scatter.xz;
    p += scatter * dissolve * uScatterStrength;
    p.x += sin(p.y * 15.0 + uTime * 3.0 + aSeed * 20.0) * uGlitchStrength * max(dissolve, arrival);
    vColor = mix(mix(aColor0, aColor1, stage), mix(aColor1, aColor2, stage), blend);
    vScatter = max(dissolve, arrival);
    return p;
  }
`;

export const pointVertex = morph + /* glsl */`
  attribute vec3 aNormal0;
  attribute vec3 aNormal1;
  attribute vec3 aNormal2;
  attribute float aFeature0;
  attribute float aFeature1;
  attribute float aFeature2;
  varying float vFacing;
  varying float vFeature;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform float uPointScale;
  uniform float uJitterAmplitude;
  uniform float uDepthSpan;
  uniform vec2 uViewportWorldSize;
  void main() {
    vec3 p = morphPosition();
    float stage = step(1.0,uProgress);
    float t=clamp(uProgress-stage,0.0,1.0);
    vec3 n=mix(mix(aNormal0,aNormal1,stage),mix(aNormal1,aNormal2,stage),t*t*(3.0-2.0*t));
    vec3 viewNormal=normalMatrix*n;
    vFacing = viewNormal.z/max(length(viewNormal),.0001);
    vFeature = mix(mix(aFeature0,aFeature1,stage),mix(aFeature1,aFeature2,stage),t*t*(3.0-2.0*t));
    p += normalize(n+vec3(.000001))*sin(uTime*.7+aSeed*6.2831853)*uJitterAmplitude*(1.0-vScatter);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    float center=(modelViewMatrix*vec4(0.0,0.0,0.0,1.0)).z;
    // The initial cloud lives in view space: its coverage is independent of
    // the model's scale, rotation and right-aligned desktop placement.
    float arrival=1.0-smoothstep(-1.0,0.0,uProgress);
    vec3 cloud=vec3(aScatter.x/2.4*uViewportWorldSize.x,
      aScatter.y/1.7*uViewportWorldSize.y,center+aScatter.z);
    view.xyz=mix(view.xyz,cloud,arrival);
    vDepth=clamp(.5+(view.z-center)/max(uDepthSpan,.001),0.0,1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(uPointSize*mix(.85,1.12,vFeature),.25,6.0)*uPointScale*uPixelRatio*mix(mix(.88,1.12,vDepth),1.0,vScatter);
  }
`;

export const pointFragment = surfacePointFragment;

