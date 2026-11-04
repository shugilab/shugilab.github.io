import * as THREE from '../../vendor/three/three.module.js';

// TubeGeometry leaves the ends open. Cords need solid cut faces; expose each
// end independently so a hidden connection inside a continuous cord is not capped.
export function closeTubeEnds(geometry,curve,{start=true,end=true}={}) {
  const ends=[...(start?[0]:[]),...(end?[1]:[])];
  const radial=geometry.parameters.radialSegments,segments=geometry.parameters.tubularSegments;
  const count=geometry.getAttribute('position').count,extra=ends.length*(radial+2);
  for(const name of ['position','normal','uv']) {
    const attribute=geometry.getAttribute(name),array=new Float32Array((count+extra)*attribute.itemSize);
    array.set(attribute.array);geometry.setAttribute(name,new THREE.BufferAttribute(array,attribute.itemSize));
  }
  const positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
  const indices=new Uint32Array(geometry.index.count+radial*3*ends.length);indices.set(geometry.index.array);
  let cursor=geometry.index.count;
  ends.forEach((end,index)=> {
    const centre=curve.getPointAt(end),normal=curve.getTangentAt(end).multiplyScalar(end?1:-1);
    const cap=count+index*(radial+2),ring=end*segments*(radial+1);
    positions.setXYZ(cap,centre.x,centre.y,centre.z);normals.setXYZ(cap,normal.x,normal.y,normal.z);
    for(let j=0;j<=radial;j++) {
      const point=new THREE.Vector3().fromBufferAttribute(positions,ring+j);
      positions.setXYZ(cap+1+j,point.x,point.y,point.z);normals.setXYZ(cap+1+j,normal.x,normal.y,normal.z);
    }
    const a=new THREE.Vector3().fromBufferAttribute(positions,cap+1).sub(centre);
    const b=new THREE.Vector3().fromBufferAttribute(positions,cap+2).sub(centre);
    const forward=a.cross(b).dot(normal)>0;
    for(let j=0;j<radial;j++) {
      indices[cursor++]=cap;indices[cursor++]=cap+1+j+(forward?0:1);indices[cursor++]=cap+1+j+(forward?1:0);
    }
  });
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
}
