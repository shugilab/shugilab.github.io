export function readParticleSettings({compact=false}={}) {
  return {size:compact?1.5:1.7,density:1,contourRatio:0};
}
export const particleCount=(base,density)=>Math.max(500,Math.round(base*density*1.5));
