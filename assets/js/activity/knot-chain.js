import * as THREE from '../../vendor/three/three.module.js';
import {createHalfKnotStack,HALF_KNOT_DATA} from './half-knot.js?v=pages-candidate-20261104-1';

export const KNOT_CHAIN=Object.freeze({
  count:3,
  halfKnotCount:6,
  ropeRadius:.024,
  bandRadius:.072,
  bandCentre:.59,
  frameBandSeparation:.40,
  tiedBandSeparation:.152,
  bandHalfSpan:2.08,
  firstKnotZ:.7708,
});

// Tension makes each free span straight. Only the small clamped region has a
// rounded transition; there is no broad sinusoidal/Gaussian bend in the rubber.
function bandHalfSeparation(x,settings) {
  const shoulder=Math.abs(x)-.10,rounding=.04;
  const distance=shoulder<=-rounding?0:shoulder>=rounding?shoulder:
    (shoulder+rounding)**2/(4*rounding);
  return settings.tiedBandSeparation/2+
    (settings.frameBandSeparation-settings.tiedBandSeparation)/2*
    distance/(settings.bandHalfSpan-.10);
}

class TautBandCurve extends THREE.Curve {
  constructor(side,settings) {super();this.side=side;this.settings=settings;this.arcLengthDivisions=400;}
  getPoint(t,target=new THREE.Vector3()) {
    const x=THREE.MathUtils.lerp(-this.settings.bandHalfSpan,this.settings.bandHalfSpan,t);
    return target.set(x,-.22,this.settings.bandCentre+this.side*bandHalfSeparation(x,this.settings));
  }
}

function attachment(halves,settings) {
  const {ropeRadius:r,bandRadius,bandCentre,tiedBandSeparation}=settings;
  const rear=bandCentre-tiedBandSeparation/2,front=bandCentre+tiedBandSeparation/2;
  const radius=bandRadius+r+.004,points=[];
  for(let i=0;i<=20;i++) {
    const angle=.9+(Math.PI/2-.9)*i/20;
    points.push(new THREE.Vector3(0,-.22+radius*Math.sin(angle),front+radius*Math.cos(angle)));
  }
  for(let i=1;i<=16;i++)points.push(new THREE.Vector3(0,-.22+radius,THREE.MathUtils.lerp(front,rear,i/16)));
  for(let i=1;i<=40;i++) {
    const angle=Math.PI/2+Math.PI*i/40;
    points.push(new THREE.Vector3(0,-.22+radius*Math.sin(angle),rear+radius*Math.cos(angle)));
  }
  for(let i=1;i<=16;i++)points.push(new THREE.Vector3(0,-.22-radius,THREE.MathUtils.lerp(rear,front,i/16)));
  for(let i=1;i<=20;i++) {
    const angle=3*Math.PI/2+(Math.PI/2-.4)*i/20;
    points.push(new THREE.Vector3(0,-.22+radius*Math.sin(angle),front+radius*Math.cos(angle)));
  }
  points.forEach((point,i)=> {
    point.x=.02-.085*Math.cos(i/(points.length-1)*Math.PI);
    point.z=bandCentre+(point.z-bandCentre)*bandHalfSeparation(point.x,settings)/(tiedBandSeparation/2);
  });
  const loop=new THREE.CatmullRomCurve3(points,false,'centripetal');
  const [blue,pink]=halves[0],bluePort=blue.getPoint(0),pinkPort=pink.getPoint(0);
  const first=loop.getPoint(0),last=loop.getPoint(1),path=new THREE.CurvePath();
  path.add(new THREE.CubicBezierCurve3(bluePort,
    bluePort.clone().addScaledVector(blue.getTangent(0),-.008),
    first.clone().addScaledVector(loop.getTangent(0),-.018),first));
  path.add(loop);
  path.add(new THREE.CubicBezierCurve3(last,
    last.clone().addScaledVector(loop.getTangent(1),.018),
    pinkPort.clone().addScaledVector(pink.getTangent(0),-.005),pinkPort));
  path.arcLengthDivisions=900;return path;
}

export function createKnotChain() {
  const settings=KNOT_CHAIN,r=settings.ropeRadius;
  const matrix=new THREE.Matrix4().set(
    r,0,0,0,
    0,0,r,-.22,
    0,r,0,settings.firstKnotZ,
    0,0,0,1,
  );
  // Each output is exactly the next reflected half-knot's input. There are no
  // separate bridges between complete knots, and no third connecting throw.
  const {halves,strands}=createHalfKnotStack({halfCount:settings.halfKnotCount,matrix});
  const knots=Array.from({length:settings.count},(_,pair)=>[0,1].map(strand=> {
    const path=new THREE.CurvePath();
    path.add(halves[pair*2][strand]);path.add(halves[pair*2+1][strand]);return path;
  }));
  strands.forEach((path,strand)=> {
    const last=halves.at(-1)[strand],start=last.getPoint(1),side=strand?1:-1;
    const end=new THREE.Vector3(side*(strand?2.45:2.40),strand?-.10:-.12,strand?1.58:1.60);
    path.add(new THREE.CubicBezierCurve3(start,
      start.clone().addScaledVector(last.getTangent(1),.045),
      end.clone().add(new THREE.Vector3(-side*.60,-.04,-.02)),end));
    path.arcLengthDivisions=2400;
  });
  const bands=[-1,1].map(side=>new TautBandCurve(side,settings));
  return {settings,halves,knots,strands,attachment:attachment(halves,settings),bands,master:HALF_KNOT_DATA};
}
