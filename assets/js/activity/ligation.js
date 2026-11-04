import * as THREE from '../../vendor/three/three.module.js';
import { createKnotChain, KNOT_CHAIN } from './knot-chain.js?v=pages-candidate-20261104-1';

const BLUE = new THREE.Color('#062479').toArray();
const PINK = new THREE.Color('#e33671').toArray();

// Relative dimensions traced from the four supplied photographs, not measured
// manufacturing dimensions. Keep the silhouette and the knot adjustable here.
export const LIGATION_SHAPE = Object.freeze({
  knotCount: KNOT_CHAIN.count,
  ropeRadius: KNOT_CHAIN.ropeRadius,
  plateWidth: 4.8,
  plateDepth: 3.1,
  uprightSpan: 4.16,
  elasticRadius: .072,
  cylinderRadius: .56,
  cylinderHeight: 1.94,
});

function roundedRectangle(width, height, radius) {
  const x = width / 2, y = height / 2, r = radius;
  const shape = new THREE.Shape();
  shape.moveTo(-x+r,-y); shape.lineTo(x-r,-y);
  shape.quadraticCurveTo(x,-y,x,-y+r); shape.lineTo(x,y-r);
  shape.quadraticCurveTo(x,y,x-r,y); shape.lineTo(-x+r,y);
  shape.quadraticCurveTo(-x,y,-x,y-r); shape.lineTo(-x,-y+r);
  shape.quadraticCurveTo(-x,-y,-x+r,-y);
  return shape;
}

function trainingStand(model, shape, chain) {
  // Broad rounded base, with four low non-slip feet.
  model.pose([0,-.86,0],[Math.PI/2,0,0],()=>
    model.extrude(roundedRectangle(shape.plateWidth,shape.plateDepth,.16),.075,
      {color:BLUE,bevel:.018,weight:.09}));
  for (const x of [-1.96,1.96]) for (const z of [-1.12,1.12]) {
    model.pose([x,-.96,z],[0,0,0],()=>
      model.surface(new THREE.CylinderGeometry(.17,.18,.09,24),BLUE,.2));
  }

  // Two distinct round elastic bands, passing through holes in the end plates.
  // The bands are not metal rails: their two loose ends fold down at one end.
  for (const [i,z] of [.39,.79].entries()) {
    model.tube(chain.bands[i],shape.elasticRadius,{segments:120,radialSegments:16,weight:.9});
    model.curve([[-2.09,-.22,z],[-2.24,-.28,z],[-2.30,-.50,z],[-2.38,-.59,z]],.072,{weight:.8,capEnd:true});
    model.curve([[2.09,-.22,z],[2.22,-.27,z],[2.21,-.43,z]],.065,{weight:.6,capEnd:true});
  }
  for (const x of [-shape.uprightSpan/2,shape.uprightSpan/2]) {
    const end = roundedRectangle(.94,.94,.075);
    for (const z of [-.2,.2]) {
      const hole = new THREE.Path(); hole.absarc(z,.12,.09,0,Math.PI*2,true);
      end.holes.push(hole);
    }
    model.pose([x,-.34,.59],[0,Math.PI/2,0],()=>
      model.extrude(end,.13,{color:BLUE,bevel:.018,weight:.36}));
  }

  // The open acrylic cylinder is hollow. Low sampling density preserves its
  // transparent character; the two lips and hook make its shape readable.
  const cx = -1.12, cz = -.66, bottom = -.80, top = bottom+shape.cylinderHeight;
  model.pose([cx,(bottom+top)/2,cz],[0,0,0],()=>
    model.surface(new THREE.CylinderGeometry(shape.cylinderRadius,shape.cylinderRadius,
      shape.cylinderHeight,64,1,true),BLUE,.045));
  for (const y of [bottom,top]) model.pose([cx,y,cz],[Math.PI/2,0,0],()=>
    model.flatRing([0,0,0],shape.cylinderRadius,shape.cylinderRadius,.022,.027,BLUE));
  model.cylinder([cx,-.76,cz],.06,.105);
  model.rod([cx,-.73,cz],[cx,-.35,cz],.025,{weight:1.1});
  model.curve([[cx,-.35,cz],[cx-.16,-.20,cz],[cx-.18,.02,cz],
    [cx-.02,.15,cz],[cx+.16,.06,cz],[cx+.16,-.08,cz]],.027,{weight:1.4});

  // Small black vertical strap post, with the bent-over tab seen in the photos.
  model.cylinder([1.08,-.77,-.69],.06,.15);
  model.box([1.08,-.28,-.69],[.105,.96,.07],BLUE,.4);
  model.box([1.14,.20,-.69],[.21,.07,.07],BLUE,.4,[0,0,-.25]);
}

function tiedCord(model, chain) {
  chain.strands.forEach((curve,i)=>
    model.tube(curve,chain.settings.ropeRadius,{color:i?PINK:BLUE,segments:1500,radialSegments:16,capEnd:true,weight:3.6}));
  model.tube(chain.attachment,chain.settings.ropeRadius,{color:BLUE,segments:320,radialSegments:16,weight:3.6});
}

export function ligationTrainer(model) {
  const chain=createKnotChain();
  model.pose([0,0,0],[.72,-.12,-.07],()=> {
    trainingStand(model,LIGATION_SHAPE,chain);
    tiedCord(model,chain);
  });
}
