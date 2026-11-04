import * as THREE from '../../vendor/three/three.module.js';
import {HALF_KNOT_DATA} from './half-knot-data.js?v=pages-candidate-20261104-1';
import {closeTubeEnds} from './tube-geometry.js?v=pages-candidate-20261104-1';

export {HALF_KNOT_DATA};

// A clamped cubic B-spline has continuous curvature inside the unit. De Boor
// evaluation uses four local control points, keeping runtime work bounded.
class CubicCordCurve extends THREE.Curve {
  constructor(points) {
    super();this.points=points;this.work=Array.from({length:4},()=>new THREE.Vector3());
    const parameters=[0];
    for(let i=1;i<points.length;i++)parameters.push(parameters[i-1]+points[i].distanceTo(points[i-1]));
    const length=parameters.at(-1);parameters.forEach((value,i)=>{parameters[i]=value/length;});
    this.knots=new Float64Array(points.length+4);
    for(let i=1;i<points.length-3;i++)this.knots[i+3]=(parameters[i]+parameters[i+1]+parameters[i+2])/3;
    this.knots.fill(1,points.length);
  }
  getPoint(t,target=new THREE.Vector3()) {
    const count=this.points.length,u=THREE.MathUtils.clamp(t,0,1),knots=this.knots;
    let lo=3,hi=count;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(knots[mid]<=u)lo=mid;else hi=mid;}
    const span=Math.min(count-1,lo);
    for(let j=0;j<4;j++)this.work[j].copy(this.points[span-3+j]);
    for(let r=1;r<=3;r++)for(let j=3;j>=r;j--) {
      const index=span-3+j,alpha=(u-knots[index])/(knots[index+4-r]-knots[index]);
      this.work[j].lerpVectors(this.work[j-1],this.work[j],alpha);
    }
    return target.copy(this.work[3]);
  }
}

class HalfKnotCurve extends THREE.Curve {
  constructor(base,index,matrix) {
    super();this.base=base;this.index=index;this.matrix=matrix;
    this.arcLengthDivisions=360;
  }
  getPoint(t,target=new THREE.Vector3()) {
    this.base.getPoint(t,target);
    target.x*=this.index%2?-1:1;
    target.y+=this.index*HALF_KNOT_DATA.pitch-HALF_KNOT_DATA.paths[0][0][1];
    return target.applyMatrix4(this.matrix);
  }
  getTangent(t,target=new THREE.Vector3()) {
    if(t===0||t===1)target.set(0,1,0);
    else this.base.getTangent(t,target);
    target.x*=this.index%2?-1:1;
    return target.transformDirection(this.matrix);
  }
}

export function createHalfKnotStack({halfCount=6,matrix=new THREE.Matrix4()}={}) {
  const bases=HALF_KNOT_DATA.paths.map(path=> {
    const points=path.map(p=>new THREE.Vector3(...p));
    return HALF_KNOT_DATA.interpolation==='cubic-bspline'?new CubicCordCurve(points):
      new THREE.CatmullRomCurve3(points,false,'centripetal');
  });
  const halves=Array.from({length:halfCount},(_,index)=>bases.map(base=>new HalfKnotCurve(base,index,matrix)));
  const strands=bases.map((_,strand)=> {
    const path=new THREE.CurvePath();
    halves.forEach(half=>path.add(half[strand]));
    path.arcLengthDivisions=halfCount*360;return path;
  });
  return {halves,strands};
}

export function createHalfKnotGeometries({halfCount=2}={}) {
  const {strands}=createHalfKnotStack({halfCount});
  const geometries=strands.map(strand=> {
    // Show the ports as solid cord ends, outside the knot body. The short
    // extensions belong to this isolated review only, never between throws.
    const start=strand.getPoint(0),end=strand.getPoint(1),curve=new THREE.CurvePath();
    curve.add(new THREE.LineCurve3(start.clone().addScaledVector(strand.getTangent(0),-1.4),start));
    curve.add(strand);
    curve.add(new THREE.LineCurve3(end,end.clone().addScaledVector(strand.getTangent(1),1.4)));
    const geometry=new THREE.TubeGeometry(curve,halfCount*900,1,24,false);
    closeTubeEnds(geometry,curve);return geometry;
  });
  const bounds=new THREE.Box3();
  geometries.forEach(geometry=>{geometry.computeBoundingBox();bounds.union(geometry.boundingBox);});
  const centre=bounds.getCenter(new THREE.Vector3());
  geometries.forEach(geometry=>geometry.translate(-centre.x,-centre.y,-centre.z));
  return geometries;
}

