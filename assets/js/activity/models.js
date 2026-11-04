import * as THREE from '../../vendor/three/three.module.js';
import { ligationTrainer } from './ligation.js?v=pages-candidate-20261104-1';
import {closeTubeEnds} from './tube-geometry.js?v=pages-candidate-20261104-1';
import {addLaparoscopicForceps} from './laparoscopic-forceps.js?v=pages-candidate-20261104-1';

const BLUE = new THREE.Color('#062479').toArray();
const PINK = new THREE.Color('#e33671').toArray();
// Pink marks the focus of each exercise: thread, grasping jaws, hand/foot inputs.
// These are editorial highlights, not the physical colors of the instruments.
const TAU = Math.PI * 2;
const vector = p => new THREE.Vector3(...p);

function seededRandom(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function transform(position = [0, 0, 0], rotation = [0, 0, 0]) {
  return new THREE.Matrix4().compose(vector(position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1));
}

class ParametricCurve extends THREE.Curve {
  constructor(fn) { super(); this.fn = fn; }
  getPoint(t, target = new THREE.Vector3()) { return target.copy(this.fn(t)); }
}

class ModelBuilder {
  constructor() {
    this.matrix = new THREE.Matrix4();
    this.surfaces = [];
    this.role = 'structure';
    this.density = 1;
  }

  part(role, density, draw) {
    const previousRole=this.role,previousDensity=this.density;
    this.role=role;this.density=density;draw();
    this.role=previousRole;this.density=previousDensity;
  }

  pose(position, rotation, draw) {
    const previous = this.matrix;
    this.matrix = previous.clone().multiply(transform(position, rotation));
    draw();
    this.matrix = previous;
  }

  surface(geometry, color = BLUE, weight = 1) {
    geometry.applyMatrix4(this.matrix);
    this.surfaces.push({ geometry, color, weight:weight*this.density, role:this.role });
  }

  tube(curve, radius, { color = BLUE, segments = 48, radialSegments = 8, closed = false, capStart = false, capEnd = false, weight = 1, taper = null } = {}) {
    const radial = radialSegments;
    const geometry = new THREE.TubeGeometry(curve, segments, radius, radial, closed);
    const positions = geometry.getAttribute('position');
    if (taper) {
      for (let i = 0; i <= segments; i++) {
        const center = curve.getPointAt(i / segments);
        for (let j = 0; j <= radial; j++) {
          const index = i * (radial + 1) + j;
          const point = new THREE.Vector3().fromBufferAttribute(positions, index).sub(center).multiplyScalar(taper(i / segments)).add(center);
          positions.setXYZ(index, point.x, point.y, point.z);
        }
      }
    }
    if(capStart||capEnd)closeTubeEnds(geometry,curve,{start:capStart,end:capEnd});
    this.surface(geometry, color, weight);
  }

  rod(a, b, radius, options = {}) {
    this.tube(new THREE.LineCurve3(vector(a), vector(b)), radius, { segments: 12, ...options });
  }

  curve(points, radius, options = {}) {
    this.tube(new THREE.CatmullRomCurve3(points.map(vector)), radius, { segments: 72, ...options });
  }

  loop(center, rx, ry, radius = .06, color = BLUE, rotation = [0, 0, 0]) {
    this.pose(center, rotation, () => this.tube(new ParametricCurve(t =>
      new THREE.Vector3(Math.cos(t * TAU) * rx, Math.sin(t * TAU) * ry, 0)), radius,
    { color, segments: 72, closed: true }));
  }

  box(center, size, color = BLUE, weight = 1, rotation = [0, 0, 0]) {
    this.pose(center, rotation, () => this.surface(new THREE.BoxGeometry(...size), color, weight));
  }

  roundedOutline(center, width, height, radius, color = BLUE, rotation = [0, 0, 0]) {
    const points = [];
    for (let corner = 0; corner < 4; corner++) {
      const cx = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
      const cy = (corner < 2 ? 1 : -1) * (height / 2 - radius);
      for (let i = 0; i <= 12; i++) {
        const angle = corner * Math.PI / 2 + i / 12 * Math.PI / 2;
        points.push(new THREE.Vector3(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 0));
      }
    }
    // A narrow rim is sampled as a surface; it is never rendered as a line.
    this.pose(center, rotation, () => this.tube(new THREE.CatmullRomCurve3(points, true), .012,
      { color, segments: 100, closed: true, weight: 2 }));
  }

  // Closed planar profiles give instruments a forged, flat cross-section.
  // They replace the round tubes used for the first draft's handles and arms.
  profile(points, depth, { color = BLUE, bevel = .018, weight = 1, holes = [] } = {}) {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(...p)));
    for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(...p))));
    this.extrude(shape, depth, { color, bevel, weight });
  }

  extrude(shape, depth, { color = BLUE, bevel = .018, weight = 1 } = {}) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 28, bevelEnabled: bevel > 0,
      bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3,
    });
    geometry.translate(0, 0, -depth/2);
    this.surface(geometry,color,weight);
  }

  flatRing(center, rx, ry, band, depth, color = BLUE, rotation = [0,0,0]) {
    const shape = new THREE.Shape(); shape.absellipse(0,0,rx,ry,0,TAU,false,0);
    const hole = new THREE.Path(); hole.absellipse(0,0,rx-band,ry-band,0,TAU,true,0); shape.holes.push(hole);
    this.pose(center,rotation,()=>this.extrude(shape,depth,{color,bevel:.012}));
  }

  cylinder(center, length, radius, color = BLUE, rotation = [0,0,0], topRadius = radius) {
    this.pose(center,rotation,()=>{
      this.surface(new THREE.CylinderGeometry(topRadius,radius,length,24,1),color);

    });
  }
}

function crossedForceps(model) {
  addLaparoscopicForceps(model,[-.03,.04,-.28],[.16,-.1,-.59]);
  model.pose([.03,-.04,.29],[-.11,.16,.59],()=>
    addLaparoscopicForceps(model,[0,0,0],[0,Math.PI,0]));
}

function simulation(model) {
  // RobotiX Mentor's compact stereoscopic viewer, master controls and pedals.
  model.part('exterior',1,()=>model.pose([-.45,0,0],[0,0,0],()=>{
    model.box([0,-.15,-.65],[.94,4.05,.62],BLUE,.85);
    model.part('detail',.15,()=>{
      for(const y of [-1.68,.55])model.box([0,y,-.29],[1.05,.09,.12]);
    });
    // Product and in-use photos put the viewer at about half the armrest width.
    // Small eyepieces sit inside a supported housing, rather than a large HMD.
    model.pose([0,1.18,.1],[.1,0,0],()=>{
      const s=.6;
      const shell = [[-1.16,-.31],[-1.22,.24],[-1.03,.49],[.99,.49],
        [1.18,.29],[1.17,-.3],[.43,-.42],[.24,-.3],[-.24,-.3],[-.45,-.42]];
      model.profile(shell.map(p=>p.map(value=>value*s)),.72*s,{bevel:.08*s,weight:1.2});
      model.pose([0,0,.23],[0,0,0],()=>
        model.profile([[-1.02,-.22],[-1.05,.22],[-.86,.35],[.86,.35],[1.05,.22],
          [1.02,-.22],[.35,-.28],[.2,-.19],[-.2,-.19],[-.35,-.28]].map(p=>p.map(value=>value*s)),
          .025,{bevel:.015,weight:.7}));
      for(const side of [-1,1]){
        model.part('eyepiece',1,()=>{
        model.flatRing([side*.24,.003,.27],.15,.13,.03,.035);
        model.flatRing([side*.24,.003,.292],.11,.095,.012,.012);
        });
        model.cylinder([side*.558,.018,-.252],.12,.084,BLUE,[Math.PI/2,0,0]);
        model.box([side*.58,.04,-.42],[.12,.12,.70],BLUE,.4);
      }
      model.box([0,.04,-.62],[1.25,.12,.14],BLUE,.4);
      model.part('detail',.15,()=>model.box([0,.306,-.012],[.42,.033,.21]));
    });
    // Curved arm rest with an open workspace, not a solid floating platform.
    model.pose([0,-.22,.29],[.12,0,0],()=>{
      model.profile([[-1.45,-.19],[-1.45,.25],[-1.2,.42],[1.2,.42],[1.45,.25],
        [1.45,-.19],[1.2,-.37],[-1.2,-.37]],.63,{bevel:.06,weight:.85,
        holes:[[[-1.18,-.13],[1.18,-.13],[1.2,.13],[-1.2,.13]]]});
    });
    for(const side of [-1,1]){
      model.box([side*1.19,-.08,.66],[.4,.13,.65],BLUE,.8);
      model.part('controls',1.5,()=>model.pose([side*.55,-.46,.76],[.07,side*-.22,side*-.2],()=>{
        model.cylinder([0,-.24,-.2],.28,.052);
        model.rod([0,-.36,-.24],[side*.17,-.16,-.04],.043);
        model.rod([side*.17,-.16,-.04],[0,.04,.04],.037);
        model.cylinder([0,.04,.04],.2,.07,PINK,[0,0,Math.PI/2]);
        model.flatRing([0,.19,.13],.18,.15,.028,.045,PINK,[.26,0,0]);
        model.rod([side*.08,.06,.13],[side*.13,.17,.22],.021,{color:PINK});
      }));
      model.part('detail',.12,()=>
        model.curve([[side*.52,-.56,.54],[side*.83,-.94,.28],[side*.66,-1.17,-.23],[side*.24,-.9,-.35]],.009,{segments:48}));
    }
    // The official 2026 brochure (p. 5) shows two round controls on the left
    // and four shoe-shaped controls in a 2 x 2 group on the right: six total.
    model.box([0,-2.07,-.05],[2.7,.19,1.85],BLUE,.65);
    model.box([0,-1.93,.09],[2.08,.08,1.2],BLUE,.7,[-.12,0,0]);
    const pedalHeight = z => -1.89 + (z-.09)*Math.tan(.12);
    for(const z of [-.23,.34]) {
      model.cylinder([-.65,pedalHeight(z)+.025,z],.05,.19,BLUE,[-.12,0,0]);
      model.part('controls',1.5,()=>model.cylinder([-.65,pedalHeight(z)+.075,z],.07,.155,PINK,[-.12,0,0]));
    }
    const shoe = new THREE.Shape();
    shoe.moveTo(-.14,-.14); shoe.lineTo(-.14,.09);
    shoe.quadraticCurveTo(-.14,.19,0,.19);
    shoe.quadraticCurveTo(.14,.19,.14,.09);
    shoe.lineTo(.14,-.14); shoe.quadraticCurveTo(.14,-.18,.10,-.18);
    shoe.lineTo(-.10,-.18); shoe.quadraticCurveTo(-.14,-.18,-.14,-.14);
    for(const x of [.17,.64])for(const z of [-.23,.34]) {
      model.part('controls',1.5,()=>model.pose([x,pedalHeight(z)+.075,z],[-Math.PI/2-.12,0,0],()=>
        model.extrude(shoe,.07,{color:PINK,bevel:.012,weight:1.2})));
      model.part('detail',.15,()=>model.rod([x-.16,pedalHeight(z-.19)+.035,z-.19],
        [x+.16,pedalHeight(z-.19)+.035,z-.19],.026,{segments:4,weight:.4}));
    }
    model.part('detail',.15,()=>{
    for(const x of [-1.13,1.13])for(const z of [-.72,.66]){
      model.cylinder([x,-2.28,z],.13,.12,BLUE,[0,0,Math.PI/2]);
      model.box([x,-2.16,z],[.1,.12,.14]);
    }
    });
  }));
}

function normalize(model) {
  const bounds = new THREE.Box3();
  for (const { geometry } of model.surfaces) {
    geometry.computeBoundingBox(); bounds.union(geometry.boundingBox);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 6.15 / Math.max(size.x, size.y, size.z);
  const matrix = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  for (const surface of model.surfaces) surface.geometry.applyMatrix4(matrix);
}

function morton(x, y, z) {
  let code = 0;
  const values = [x, y, z].map(v => Math.max(0, Math.min(1023, Math.round((v + 4) / 8 * 1023))));
  for (let bit = 0; bit < 10; bit++) for (let axis = 0; axis < 3; axis++) code |= ((values[axis] >>> bit) & 1) << (bit * 3 + axis);
  return code >>> 0;
}

function sampleSurface(model, count, random) {
  const triangles = []; let total = 0;
  for (const [surfaceId,{ geometry, color, weight, role='structure' }] of model.surfaces.entries()) {
    const positions = geometry.getAttribute('position'), indices = geometry.index;
    const length = indices ? indices.count : positions.count;
    for (let i = 0; i < length; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i) : i);
      const b = new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i+1) : i+1).sub(a);
      const c = new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i+2) : i+2).sub(a);
      const normal = new THREE.Vector3().crossVectors(b,c);
      const area = normal.length() * .5 * weight;
      if (area < 1e-10) continue;
      total += area; triangles.push({ a, b, c, normal: normal.normalize(), color, role, surfaceId, cumulative: total,
        normals:geometry.attributes.normal,ia:indices?indices.getX(i):i,ib:indices?indices.getX(i+1):i+1,ic:indices?indices.getX(i+2):i+2 });
    }
  }
  const samples = []; let triangle = 0;
  for (let i = 0; i < count; i++) {
    const target = (i + random()) / count * total;
    while (triangles[triangle].cumulative < target) triangle++;
    const t = triangles[triangle], r = Math.sqrt(random()), s = random();
    const p = t.a.clone().addScaledVector(t.b, r * (1-s)).addScaledVector(t.c, r * s);
    const normal=t.normal.clone();
    if(t.normals) {
      const n=t.normals,u=1-r,v=r*(1-s),w=r*s;
      normal.set(n.getX(t.ia)*u+n.getX(t.ib)*v+n.getX(t.ic)*w,
        n.getY(t.ia)*u+n.getY(t.ib)*v+n.getY(t.ic)*w,
        n.getZ(t.ia)*u+n.getZ(t.ib)*v+n.getZ(t.ic)*w).normalize();
    }
    samples.push({ point: p, normal, color: t.color, role:t.role, surfaceId:t.surfaceId, order: morton(p.x,p.y,p.z) });
  }
  samples.sort((a,b) => a.order-b.order);
  return samples;
}

// The review page renders the very same surfaces before particle sampling.
// Ownership passes to the caller, which disposes the returned geometries.
const MODEL_IDS=['suture','laparoscopy','simulation'];
const MODEL_MAKERS=[ligationTrainer,crossedForceps,simulation];

function sampleFeatureEdges(surfaces,count,random) {
  const edges=[];let total=0;
  const key=(x,y,z)=>`${Math.round(x*1e5)},${Math.round(y*1e5)},${Math.round(z*1e5)}`;
  for(const [surfaceId,{geometry,color,weight,role='structure'}] of surfaces.entries()) {
    if(role==='detail')continue;
    const p=geometry.attributes.position,n=geometry.attributes.normal,averages=new Map();
    for(let i=0;i<p.count;i++) {
      const id=key(p.getX(i),p.getY(i),p.getZ(i));
      if(!averages.has(id))averages.set(id,new THREE.Vector3());
      averages.get(id).add(new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i)));
    }
    const feature=new THREE.EdgesGeometry(geometry,35),vertices=feature.attributes.position;
    for(let i=0;i<vertices.count;i+=2) {
      const a=new THREE.Vector3().fromBufferAttribute(vertices,i),b=new THREE.Vector3().fromBufferAttribute(vertices,i+1);
      const length=a.distanceTo(b)*weight;
      if(length<1e-8)continue;
      const na=averages.get(key(a.x,a.y,a.z)).clone().normalize();
      const nb=averages.get(key(b.x,b.y,b.z)).clone().normalize();
      total+=length;edges.push({a,b,na,nb,color,role,surfaceId,cumulative:total});
    }
    feature.dispose();
  }
  if(!edges.length)return [];
  const samples=[];let edge=0;
  for(let i=0;i<count;i++) {
    const target=(i+random())/count*total;
    while(edges[edge].cumulative<target)edge++;
    const e=edges[edge],t=random(),point=e.a.clone().lerp(e.b,t);
    samples.push({point,normal:e.na.clone().lerp(e.nb,t).normalize(),color:e.color,role:e.role,surfaceId:e.surfaceId,feature:true,order:morton(point.x,point.y,point.z)});
  }
  return samples;
}

export function createActivitySurfaces(id='suture') {
  const index=MODEL_IDS.indexOf(id);
  if(index<0)throw new RangeError('Unknown activity model: '+id);
  const model = new ModelBuilder();
  MODEL_MAKERS[index](model); normalize(model);
  return model.surfaces;
}

export function createLigationSurfaces() {return createActivitySurfaces('suture');}

export function sampleActivitySurfaces(surfaces,{pointCount=12000,id='suture',contourRatio,minimumPerSurface=0}={}) {
  const index=MODEL_IDS.indexOf(id);
  if(index<0)throw new RangeError('Unknown activity model: '+id);
  const random=seededRandom(731+index);
  // Feature points remain on mesh edges; no lines or interior volume samples.
  const ratio=typeof contourRatio==='number'&&Number.isFinite(contourRatio)?Math.min(1,Math.max(0,contourRatio)):id==='simulation'?.28:0;
  const features=ratio>0?sampleFeatureEdges(surfaces,Math.round(pointCount*ratio),random):[];
  const reserved=[];
  if(minimumPerSurface) {
    const minima=surfaces.map(surface=>Math.max(0,typeof minimumPerSurface==='function'?minimumPerSurface(surface):minimumPerSurface));
    const sum=minima.reduce((a,b)=>a+b,0),scale=Math.min(1,(pointCount-features.length)*.65/Math.max(1,sum));
    surfaces.forEach((surface,surfaceId)=>{
      const count=Math.floor(minima[surfaceId]*scale);
      if(!count)return;
      const samples=sampleSurface({surfaces:[surface]},count,random);
      samples.forEach(sample=>sample.surfaceId=surfaceId);reserved.push(...samples);
    });
  }
  const samples=sampleSurface({surfaces},pointCount-features.length-reserved.length,random).concat(features,reserved);
  samples.sort((a,b)=>a.order-b.order);
  const points=new Float32Array(pointCount*3),colors=new Float32Array(pointCount*3),normals=new Float32Array(pointCount*3),feature=new Float32Array(pointCount),surfaceIds=new Uint16Array(pointCount);
  samples.forEach((sample,i)=>{sample.point.toArray(points,i*3);sample.normal.toArray(normals,i*3);colors.set(sample.color,i*3);feature[i]=sample.feature?1:0;surfaceIds[i]=sample.surfaceId;});
  const sampling={};
  samples.forEach(sample=>sampling[sample.role]=(sampling[sample.role]||0)+1);
  return {id,points,normals,colors,feature,surfaceIds,sampling,surfaceOnly:true,featurePoints:features.length};
}

export function createActivityModels({ pointCount = 12000, retainSurfaces = false, contourRatio } = {}) {
  return MODEL_IDS.map(id => {
    const surfaces=createActivitySurfaces(id);
    const result=sampleActivitySurfaces(surfaces,{pointCount,id,contourRatio});
    if(retainSurfaces)result.surfaces=surfaces;
    else for (const { geometry } of surfaces) geometry.dispose();
    return result;
  });
}
