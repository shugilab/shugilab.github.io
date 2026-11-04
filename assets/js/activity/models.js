import * as THREE from '../../vendor/three/three.module.js';
import { ligationTrainer } from './ligation.js?v=pages-candidate-20261104-18';
import {closeTubeEnds} from './tube-geometry.js?v=pages-candidate-20261104-18';
import {addLaparoscopicForceps} from './laparoscopic-forceps.js?v=pages-candidate-20261104-18';

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

  tube(curve, radius, { color = BLUE, segments = 48, radialSegments = 8, closed = false, capStart = false, capEnd = false, weight = 1, taper = null, colorAt = null } = {}) {
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
    if(colorAt) {
      const attribute=new Float32Array(geometry.attributes.position.count*3);
      for(let i=0;i<=segments;i++)for(let j=0;j<=radial;j++)attribute.set(colorAt(i/segments),(i*(radial+1)+j)*3);
      geometry.setAttribute('color',new THREE.BufferAttribute(attribute,3));
      geometry.userData.colorBoundary=curve.colorBoundary;
    }
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
    model.box([0,-.10,-.65],[.74,3.95,.48],BLUE,.25);
    // Product and in-use photos put the viewer at about half the armrest width.
    // Small eyepieces sit inside a supported housing, rather than a large HMD.
    model.pose([0,1.18,.1],[.1,0,0],()=>{
      const s=.6;
      const shell = [[-1.16,-.31],[-1.22,.24],[-1.03,.49],[.99,.49],
        [1.18,.29],[1.17,-.3],[.43,-.42],[.24,-.3],[-.24,-.3],[-.45,-.42]];
      const apertures=[-1,1].map(side=>Array.from({length:40},(_,i)=>{
        const angle=i/40*TAU;return [side*.24+.103*Math.cos(angle),.003+.088*Math.sin(angle)];
      }));
      model.profile(shell.map(p=>p.map(value=>value*s)),.72*s,{bevel:.025,weight:1.2,holes:apertures});
      model.pose([0,0,.23],[0,0,0],()=>
        model.profile([[-1.02,-.22],[-1.05,.22],[-.86,.35],[.86,.35],[1.05,.22],
          [1.02,-.22],[.35,-.28],[.2,-.19],[-.2,-.19],[-.35,-.28]].map(p=>p.map(value=>value*s)),
          .025,{bevel:.008,weight:.7,holes:apertures}));
      for(const side of [-1,1]){
        model.part('eyepiece',1,()=>{
        model.flatRing([side*.24,.003,.27],.15,.13,.03,.035);
        model.flatRing([side*.24,.003,.292],.11,.095,.012,.012);
        });
        // A recessed optical baffle prevents the rear support's particles
        // showing through the binocular openings. It contributes depth only.
        model.part('optics',1,()=>{
          const lens=new THREE.CircleGeometry(.096,40);
          lens.scale(1,.86,1);lens.translate(side*.24,.003,.13);
          model.surface(lens,BLUE,0);
        });
      }
      model.box([0,.04,-.39],[.88,.10,.46],BLUE,.3);
    });
    // A thin horizontal table reads more clearly in particles than the
    // recessed O-shaped arm rest. Both masters sit above its top surface.
    model.box([0,-.38,.12],[2.65,.10,1.18],BLUE,.35);
    for(const side of [-1,1]){
      // The supplied product close-up shows two close-set cylindrical
      // masters, small side finger rests and a circular gimbal, not V handles.
      model.cylinder([side*.26,-.31,.58],.08,.085,BLUE);
      model.part('hand-control',3,()=>model.pose([side*.26,-.25,.58],[.06,side*.08,side*-.12],()=>{
        model.surface(new THREE.SphereGeometry(.062,16,10),BLUE,.7);
        model.cylinder([0,.15,0],.26,.035,PINK);
        model.cylinder([0,.07,0],.18,.028,BLUE,[0,0,Math.PI/2]);
        for(const finger of [-1,1])model.box([finger*.07,.075,.04],[.08,.09,.04],PINK);
      }));
    }
    // The official 2026 brochure (p. 5) shows two round controls on the left
    // and four shoe-shaped controls in a 2 x 2 group on the right: six total.
    model.box([0,-2.07,.04],[2.7,.10,1.65],BLUE,.2);
    const pedalHeight = z => -1.96 + (z-.04)*Math.tan(.06);
    for(const z of [-.34,.40]) {
      model.part('pedal',3,()=>model.cylinder([-.70,pedalHeight(z),z],.065,.16,PINK,[-.08,0,0]));
    }
    const shoe = new THREE.Shape();
    shoe.moveTo(-.14,-.14); shoe.lineTo(-.14,.09);
    shoe.quadraticCurveTo(-.14,.19,0,.19);
    shoe.quadraticCurveTo(.14,.19,.14,.09);
    shoe.lineTo(.14,-.14); shoe.quadraticCurveTo(.14,-.18,.10,-.18);
    shoe.lineTo(-.10,-.18); shoe.quadraticCurveTo(-.14,-.18,-.14,-.14);
    for(const x of [.16,.72])for(const z of [-.34,.40]) {
      model.part('pedal',3,()=>model.pose([x,pedalHeight(z),z],[-Math.PI/2-.08,0,0],()=>
        model.extrude(shoe,.055,{color:PINK,bevel:.006,weight:1})));
    }
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
      total += area; triangles.push({ a, b, c, normal: normal.normalize(), color, role, surfaceId, weight, cumulative: total,
        vertexColors:geometry.attributes.color,
        normals:geometry.attributes.normal,ia:indices?indices.getX(i):i,ib:indices?indices.getX(i+1):i+1,ic:indices?indices.getX(i+2):i+2 });
    }
  }
  const samples = [],buckets=new Map(); let triangle = 0;
  for (let i = 0; i < count; i++) {
    const target = (i + random()) / count * total;
    while (triangles[triangle].cumulative < target) triangle++;
    const t = triangles[triangle],cellSize=Math.sqrt(total/(count*t.weight))*.65;
    const key=cell=>`${t.surfaceId}/${cell.join(',')}`;
    let best=null;
    // A few candidates per stratified surface sample suppress accidental
    // clumps without imposing a lattice or changing the model's silhouette.
    for(let attempt=0;attempt<4;attempt++) {
      const r=Math.sqrt(random()),s=random(),v=r*(1-s),w=r*s;
      const point=t.a.clone().addScaledVector(t.b,v).addScaledVector(t.c,w);
      const cell=[point.x,point.y,point.z].map(value=>Math.floor(value/cellSize));
      let distance=cellSize*cellSize*4;
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++) {
        const near=buckets.get(key([cell[0]+x,cell[1]+y,cell[2]+z]));
        if(near)for(const existing of near)distance=Math.min(distance,point.distanceToSquared(existing));
      }
      if(!best||distance>best.distance)best={point,cell,v,w,distance};
    }
    const p=best.point,u=1-best.v-best.w,v=best.v,w=best.w,bucketKey=key(best.cell);
    if(!buckets.has(bucketKey))buckets.set(bucketKey,[]);buckets.get(bucketKey).push(p);
    const normal=t.normal.clone();
    if(t.normals) {
      const n=t.normals;
      normal.set(n.getX(t.ia)*u+n.getX(t.ib)*v+n.getX(t.ic)*w,
        n.getY(t.ia)*u+n.getY(t.ib)*v+n.getY(t.ic)*w,
        n.getZ(t.ia)*u+n.getZ(t.ib)*v+n.getZ(t.ic)*w).normalize();
    }
    const color=t.vertexColors?[0,1,2].map(channel=>
      t.vertexColors.array[t.ia*3+channel]*u+t.vertexColors.array[t.ib*3+channel]*v+t.vertexColors.array[t.ic*3+channel]*w):t.color;
    samples.push({ point: p, normal, color, role:t.role, surfaceId:t.surfaceId, order: morton(p.x,p.y,p.z) });
  }
  samples.sort((a,b) => a.order-b.order);
  return samples;
}

// The review page renders the very same surfaces before particle sampling.
// Ownership passes to the caller, which disposes the returned geometries.
const MODEL_IDS=['suture','laparoscopy','simulation'];
const MODEL_MAKERS=[ligationTrainer,crossedForceps,simulation];

export function createActivitySurfaces(id='suture') {
  const index=MODEL_IDS.indexOf(id);
  if(index<0)throw new RangeError('Unknown activity model: '+id);
  const model = new ModelBuilder();
  MODEL_MAKERS[index](model); normalize(model);
  return model.surfaces;
}

export function createLigationSurfaces() {return createActivitySurfaces('suture');}

export function sampleActivitySurfaces(surfaces,{pointCount=12000,id='suture',minimumPerSurface=surface=>{
  const share=surface.role==='eyepiece'?.02:surface.role==='hand-control'?.012:surface.role==='pedal'?.03:0;
  return share?Math.max(48,Math.round(pointCount*share)):0;
}}={}) {
  const index=MODEL_IDS.indexOf(id);
  if(index<0)throw new RangeError('Unknown activity model: '+id);
  const random=seededRandom(731+index);
  const reserved=[];
  if(minimumPerSurface) {
    const minima=surfaces.map(surface=>Math.max(0,typeof minimumPerSurface==='function'?minimumPerSurface(surface):minimumPerSurface));
    const sum=minima.reduce((a,b)=>a+b,0),scale=Math.min(1,pointCount*.65/Math.max(1,sum));
    surfaces.forEach((surface,surfaceId)=>{
      const count=Math.floor(minima[surfaceId]*scale);
      if(!count)return;
      const samples=sampleSurface({surfaces:[surface]},count,random);
      samples.forEach(sample=>sample.surfaceId=surfaceId);reserved.push(...samples);
    });
  }
  const samples=sampleSurface({surfaces},pointCount-reserved.length,random).concat(reserved);
  samples.sort((a,b)=>a.order-b.order);
  const points=new Float32Array(pointCount*3),colors=new Float32Array(pointCount*3),normals=new Float32Array(pointCount*3),feature=new Float32Array(pointCount),surfaceIds=new Uint16Array(pointCount);
  samples.forEach((sample,i)=>{sample.point.toArray(points,i*3);sample.normal.toArray(normals,i*3);colors.set(sample.color,i*3);feature[i]=sample.feature?1:0;surfaceIds[i]=sample.surfaceId;});
  const sampling={};
  samples.forEach(sample=>sampling[sample.role]=(sampling[sample.role]||0)+1);
  return {id,points,normals,colors,feature,surfaceIds,sampling,surfaceOnly:true,featurePoints:0};
}

export function createActivityModels({ pointCount = 12000, retainSurfaces = false } = {}) {
  return MODEL_IDS.map(id => {
    const surfaces=createActivitySurfaces(id);
    const result=sampleActivitySurfaces(surfaces,{pointCount,id});
    if(retainSurfaces)result.surfaces=surfaces;
    else for (const { geometry } of surfaces) geometry.dispose();
    return result;
  });
}
