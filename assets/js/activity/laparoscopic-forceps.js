import * as THREE from '../../vendor/three/three.module.js';
import {FORCEPS_MODEL} from '../../models/laparoscopic-forceps/model-data.js?v=pages-candidate-20261104-1';

const BLUE=new THREE.Color('#062479').toArray(),PINK=new THREE.Color('#e33671').toArray();
let templates;

function unpack(encoded,Type) {
  const text=atob(encoded),bytes=new Uint8Array(text.length);
  for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);
  return new Type(bytes.buffer);
}

function orientClosedPart(geometry) {
  geometry.computeBoundingBox();
  const center=geometry.boundingBox.getCenter(new THREE.Vector3());
  const p=geometry.attributes.position,n=geometry.attributes.normal,index=geometry.index;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3(),normal=new THREE.Vector3();
  let volume=0,agreement=0;
  for(let i=0;i<index.count;i+=3) {
    const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);
    a.fromBufferAttribute(p,ia).sub(center);b.fromBufferAttribute(p,ib).sub(center);c.fromBufferAttribute(p,ic).sub(center);
    volume+=a.dot(cross.crossVectors(b,c));
    cross.crossVectors(b.sub(a),c.sub(a));
    normal.fromBufferAttribute(n,ia).add(new THREE.Vector3().fromBufferAttribute(n,ib)).add(new THREE.Vector3().fromBufferAttribute(n,ic));
    agreement+=cross.dot(normal);
  }
  const flipWinding=volume<0,flipNormals=agreement*(flipWinding?-1:1)<0;
  if(flipWinding)for(let i=0;i<index.count;i+=3) {
    const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);
  }
  if(flipNormals)for(let i=0;i<n.count;i++)n.setXYZ(i,-n.getX(i),-n.getY(i),-n.getZ(i));
  geometry.userData.orientation={windingCorrected:flipWinding,normalsCorrected:flipNormals};
}

function loadTemplates() {
  if(templates)return templates;
  templates=FORCEPS_MODEL.parts.map(part=> {
    const quantized=unpack(part.positions,Int16Array),packedNormals=unpack(part.normals,Int8Array);
    const positions=new Float32Array(quantized.length),normals=new Float32Array(packedNormals.length);
    for(let i=0;i<positions.length;i++) {
      positions[i]=part.origin[i%3]+quantized[i]*part.scale[i%3];
      normals[i]=packedNormals[i]/127;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geometry.setIndex(new THREE.BufferAttribute(unpack(part.indices,part.indexType==='u16'?Uint16Array:Uint32Array),1));
    geometry.normalizeNormals();
    // Two imported handle parts are inside-out. Fix orientation, not density.
    orientClosedPart(geometry);
    geometry.userData.sourcePart=part.name;
    return {geometry,color:part.role==='jaw'?PINK:BLUE,weight:part.weight};
  });
  return templates;
}

// The MIT-licensed source mesh is retained, rather than approximated with
// generated primitives. Pink identifies its two functional gripping jaws.
export function addLaparoscopicForceps(model,position,rotation) {
  model.pose(position,rotation,()=> {
    for(const part of loadTemplates())model.surface(part.geometry.clone(),part.color,part.weight);
  });
}

export const FORCEPS_SOURCE={url:FORCEPS_MODEL.source,commit:FORCEPS_MODEL.commit,license:FORCEPS_MODEL.license};
