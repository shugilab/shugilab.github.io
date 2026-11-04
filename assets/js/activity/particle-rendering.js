import * as THREE from '../../vendor/three/three.module.js';

export const PARTICLE_STYLE = {
  blue: '#062479', pink: '#e33671', size: 1.7, jitter: .0015,
};

// The HOME model is 6.15 units across, viewed through an 8.4-unit camera.
// Preserve its particle/model proportions relative to a 768px-high view.
export const PARTICLE_REFERENCE_EXTENT = 6.15*768/8.4;
export function particleModelScale(projectedExtent) {
  return Number.isFinite(projectedExtent)&&projectedExtent>0?projectedExtent/PARTICLE_REFERENCE_EXTENT:1;
}
export function particleDisplayScale(projectedExtent,{compact=false}={}) {
  // Phones/tablets keep a stable CSS-pixel diameter. Wide layouts retain
  // proportional model scaling, with twice the previous particle diameter.
  return .6*(compact?1:2*particleModelScale(projectedExtent));
}

// Both HOME and the model lab use this shading and the same depth prepass.
export const surfacePointFragment = /* glsl */`
  uniform sampler2D uDepthMap;
  uniform vec2 uDepthMapSize;
  uniform float uDepthBias;
  uniform float uMaskStrength;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vFacing;
  varying float vScatter;
  varying float vFeature;
  varying float vDepth;
  void main() {
    float circle = 1.0 - smoothstep(.4, .5, length(gl_PointCoord - .5));
    if (circle < .01) discard;
    float depth = texture2D(uDepthMap, gl_FragCoord.xy / uDepthMapSize).x;
    float hidden = step(depth + uDepthBias, gl_FragCoord.z);
    float front = smoothstep(-.012, .025, vFacing);
    float visibility = mix(1.0, (1.0-hidden)*front, uMaskStrength);
    float rim = max(pow(1.0-clamp(vFacing,0.0,1.0), 1.7),vFeature*.6);
    vec3 color = vColor;
    float depthFade=mix(.70,1.0,vDepth);
    float alpha = circle*uOpacity*visibility*mix(.85,1.0,rim)*mix(depthFade,1.0,vScatter)*(1.0-vScatter*.16);
    if(alpha < .008) discard;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export function particleUniforms() {
  return {
    uDepthMap: {value:null}, uDepthMapSize: {value:new THREE.Vector2(1,1)},
    uDepthBias: {value:.0001}, uMaskStrength: {value:1}, uOpacity: {value:.9},
    uPointSize: {value:PARTICLE_STYLE.size}, uPixelRatio: {value:1},
    uPointScale: {value:1},
    uDepthSpan: {value:6.15},
    uTime: {value:0}, uJitterAmplitude: {value:PARTICLE_STYLE.jitter},
  };
}

function mergeDepthSurfaces(surfaces) {
  // Keep indices: the software mask also projects shared vertices only once.
  const included=surfaces.filter(s=>s.weight!==.045 && s.role!=='transparent');
  const vertices=included.reduce((n,s)=>n+s.geometry.attributes.position.count,0);
  const elements=included.reduce((n,s)=>n+(s.geometry.index?.count??s.geometry.attributes.position.count),0);
  const positions=new Float32Array(vertices*3),indices=new Uint32Array(elements);
  let vertex=0,element=0;
  for(const {geometry} of included) {
    const p=geometry.attributes.position;
    for(let i=0;i<p.count;i++) {
      positions[(vertex+i)*3]=p.getX(i);positions[(vertex+i)*3+1]=p.getY(i);positions[(vertex+i)*3+2]=p.getZ(i);
    }
    const length=geometry.index?.count??p.count;
    for(let i=0;i<length;i++)indices[element++]=vertex+(geometry.index?geometry.index.getX(i):i);
    vertex+=p.count;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  return geometry;
}

export function createSurfaceDepthPass(surfaceSets) {
  const scene=new THREE.Scene(),root=new THREE.Group();scene.add(root);
  root.matrixAutoUpdate=false;
  const material=new THREE.MeshBasicMaterial({
    colorWrite:false,depthWrite:true,depthTest:true,side:THREE.DoubleSide,
  });
  const meshes=surfaceSets.map(surfaces=>{
    const mesh=new THREE.Mesh(mergeDepthSurfaces(surfaces),material);
    mesh.visible=false;mesh.frustumCulled=false;root.add(mesh);return mesh;
  });
  const texture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const target=new THREE.WebGLRenderTarget(1,1,{depthTexture:texture,depthBuffer:true,stencilBuffer:false});
  const drawingSize=new THREE.Vector2();
  const matrix=new THREE.Matrix4(),previousMatrix=new Float64Array(16).fill(NaN);
  let software,projected,softwareWidth=0,softwareHeight=0,previousIndex=-1;
  let currentIndex=-1;
  function select(index) {
    if(currentIndex===index)return;
    meshes.forEach((mesh,i)=>mesh.visible=i===index);currentIndex=index;
  }
  return {
    geometries:meshes.map(mesh=>mesh.geometry),
    render(renderer,camera,group,index,uniforms) {
      select(index);group.updateWorldMatrix(true,false);root.matrix.copy(group.matrixWorld);root.matrixWorldNeedsUpdate=true;
      renderer.getDrawingBufferSize(drawingSize);
      if(target.width!==drawingSize.x||target.height!==drawingSize.y)target.setSize(drawingSize.x,drawingSize.y);
      const previous=renderer.getRenderTarget();
      renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(previous);
      uniforms.uDepthMap.value=target.depthTexture;
      uniforms.uDepthMapSize.value.copy(drawingSize);
      uniforms.uDepthBias.value=.008/(camera.far-camera.near);
    },
    // A small triangle z-buffer keeps hidden surfaces hidden without WebGL.
    softwareMask(camera,group,index,width,height) {
      group.updateWorldMatrix(true,false);camera.updateWorldMatrix(true,false);
      matrix.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(group.matrixWorld);
      const scale=Math.min(1,420/Math.max(width,height));
      const w=Math.ceil(width*scale),h=Math.ceil(height*scale),m=matrix.elements;
      if(index===previousIndex&&w===softwareWidth&&h===softwareHeight&&m.every((v,i)=>v===previousMatrix[i]))return {data:software,width:w,height:h};
      previousIndex=index;previousMatrix.set(m);softwareWidth=w;softwareHeight=h;
      if(software?.length!==w*h)software=new Float32Array(w*h);software.fill(1);
      const geometry=meshes[index].geometry,p=geometry.attributes.position.array,indices=geometry.index.array;
      if(projected?.length!==p.length)projected=new Float32Array(p.length);
      for(let i=0;i<p.length;i+=3) {
        const x=p[i],y=p[i+1],z=p[i+2],q=1/(m[3]*x+m[7]*y+m[11]*z+m[15]);
        projected[i]=((m[0]*x+m[4]*y+m[8]*z+m[12])*q*.5+.5)*w;
        projected[i+1]=(-(m[1]*x+m[5]*y+m[9]*z+m[13])*q*.5+.5)*h;
        projected[i+2]=(m[2]*x+m[6]*y+m[10]*z+m[14])*q*.5+.5;
      }
      for(let i=0;i<indices.length;i+=3) {
        const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
        const ax=projected[a],ay=projected[a+1],bx=projected[b],by=projected[b+1],cx=projected[c],cy=projected[c+1];
        const area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
        if(Math.abs(area)<1e-8)continue;
        const left=Math.max(0,Math.floor(Math.min(ax,bx,cx))),right=Math.min(w-1,Math.ceil(Math.max(ax,bx,cx)));
        const top=Math.max(0,Math.floor(Math.min(ay,by,cy))),bottom=Math.min(h-1,Math.ceil(Math.max(ay,by,cy)));
        for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++) {
          const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/area;
          const v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/area;
          if(u<0||v<0||u+v>1)continue;
          const depth=u*projected[a+2]+v*projected[b+2]+(1-u-v)*projected[c+2],offset=y*w+x;
          if(depth<software[offset])software[offset]=depth;
        }
      }
      return {data:software,width:w,height:h};
    },
    dispose() {meshes.forEach(mesh=>mesh.geometry.dispose());material.dispose();target.dispose();},
  };
}
