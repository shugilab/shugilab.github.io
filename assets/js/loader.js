const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
const smoother=t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
const range=(t,a,b)=>clamp((t-a)/(b-a));
const outCubic=t=>1-Math.pow(1-clamp(t),3);
function bezier(a,b,c,d,t) {
  const s=1-t;
  return {x:s*s*s*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t*t*t*d.x,
          y:s*s*s*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t*t*t*d.y};
}

function makeTarget(kind) {
  const points=[];
  const startX=kind==='blue'?53.9243:42.2231;
  const startY=kind==='blue'?116.76249:84.78739;
  for(let half=0;half<3;half++) {
    const sign=(kind==='blue'?-1:1)*(half%2?-1:1);
    const x=startX+half*37.2585;
    const y=half%2?(kind==='blue'?84.78749:116.76239):startY;
    const endY=y+sign*31.975;
    const a={x,y};
    const d={x:x+6.923,y:y+sign*1.777};
    const e={x:x+37.2585,y:endY};
    const raw=[];
    for(let j=0;j<=24;j++) raw.push(bezier(a,{x:x+2.653,y},{x:x+4.918,y:y+sign*.665},d,j/24));
    for(let j=1;j<=96;j++) raw.push(bezier(d,{x:x+18.9975,y:y+sign*8.4745},{x:x+21.2815,y:endY},e,j/96));
    let total=0;
    raw[0].distance=0;
    for(let j=1;j<raw.length;j++) {
      total+=Math.hypot(raw[j].x-raw[j-1].x,raw[j].y-raw[j-1].y);
      raw[j].distance=total;
    }
    let cursor=1;
    for(let j=0;j<=100;j++) {
      if(half && j===0) continue;
      const dist=j/100*total;
      while(cursor<raw.length-1 && raw[cursor].distance<dist) cursor++;
      const p=raw[cursor-1],q=raw[cursor];
      const t=clamp((dist-p.distance)/Math.max(.00001,q.distance-p.distance));
      points.push({x:lerp(p.x,q.x,t)+6.923,y:lerp(p.y,q.y,t),u:(half+j/100)/3,phase:(half+j/100)*Math.PI});
    }
  }
  return points;
}

export class RibbonLoader {
  constructor({root,page,markSvg,capture=false}) {
    this.root=root;
    this.page=page;
    this.canvas=root.querySelector('canvas');
    this.liveStatus=root.querySelector('[aria-live]');
    this.capture=capture;
    this.ctx=this.canvas.getContext('2d',{alpha:true});
    this.layers=Array.from({length:3},()=>{const canvas=document.createElement('canvas');return {canvas,ctx:canvas.getContext('2d')};});
    const fadeCanvas=document.createElement('canvas');
    this.fadeMask={canvas:fadeCanvas,ctx:fadeCanvas.getContext('2d',{willReadFrequently:true})};
    this.targets={blue:makeTarget('blue'),pink:makeTarget('pink')};
    this.mark=new Image();
    this.mark.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markSvg);
    this.masks=['blue','pink'].map(kind=>{
      const svg=new DOMParser().parseFromString(markSvg,'image/svg+xml').documentElement;
      const paths=[...svg.querySelectorAll('path')];
      for(let i=0;i<paths.length;i+=2) {
        if((paths[i].getAttribute('fill')==='#062479')!==(kind==='blue')) {
          paths[i].remove();paths[i+1].remove();
        }
      }
      const image=new Image();
      image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
      const canvas=document.createElement('canvas');
      return {kind,image,canvas,ctx:canvas.getContext('2d')};
    });
    this.markReady=Promise.all([this.mark,...this.masks.map(mask=>mask.image)].map(image=>image.decode())).then(()=>this.resize());
    this.enter=3950;this.hold=950;this.leave=800;
    this.entryTravel=1550;this.speed=1.25;
    this.running=false;this.token=0;this.exitAt=null;this.lastTime=0;
    this.frame=this.frame.bind(this);
    this.resize=this.resize.bind(this);
    window.addEventListener('resize',this.resize,{passive:true});
    this.resizeObserver=new ResizeObserver(this.resize);
    this.resizeObserver.observe(root);
    this.resize();
  }
  resize() {
    const bounds=this.root.getBoundingClientRect();
    if(!bounds.width||!bounds.height)return;
    this.w=bounds.width;this.h=bounds.height;
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    for(const {canvas,ctx} of [{canvas:this.canvas,ctx:this.ctx},...this.layers,...this.masks]) {
      canvas.width=Math.round(this.w*this.dpr);canvas.height=Math.round(this.h*this.dpr);
      ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    }
    this.logoWidth=Math.min(this.w*.76,480);
    this.scale=this.logoWidth/139.3;
    this.lengths={};
    for(const [kind,points] of Object.entries(this.targets)) {
      this.lengths[kind]=0;
      for(let i=1;i<points.length;i++) {
        const a=points[i-1],b=points[i];
        this.lengths[kind]+=Math.hypot((b.x-a.x)*this.scale,(b.y-a.y)*this.scale,
          (Math.sin(b.phase)-Math.sin(a.phase))*15.9875*this.scale);
      }
    }
    for(const {ctx,image} of this.masks) {
      // Keep only the area outside each ribbon's original SVG silhouette.
      ctx.fillStyle='#000';ctx.fillRect(0,0,this.w,this.h);
      ctx.save();ctx.globalCompositeOperation='destination-out';
      this.drawExact(ctx,image);ctx.restore();
    }
    if(this.running||this.capture)this.render(this.lastTime);
  }
  parameters(ms) {
    const e=this.exitAt!==null?range(ms,this.exitAt,this.exitAt+this.leave):0;
    const p=range(ms,0,this.enter);
    const winding=range(ms,820,this.enter);
    const wind=1-Math.pow(1-winding,3)*(1+3*winding);
    return {wind,settle:outCubic(p),shift:-(1-smoother(range(ms,0,this.entryTravel))),
      endFade:1-smoother(range(p,.90,1)),
      focus:smoother(range(p,.985,1)),exit:e,enter:p,time:Math.min(ms,this.enter)/1000};
  }
  vertices(kind,p) {
    const blue=kind==='blue', sign=blue?1:-1;
    const s=this.scale, q=p.wind, fit=smoother(range(q,.76,1));
    const sep=Math.min(this.h*.23,130);
    const radius=lerp(sep,15.9875*s,p.settle);
    const span=111.7755*s;
    const length=this.lengths[kind];
    const offset=sign*p.shift*(this.w/2+length/2+6.923*s+40);
    const cx=this.w/2+offset;
    const half=lerp(clamp(this.w*.023,17,29),6.923*s,p.settle);
    const roll=q*Math.PI*.5;
    const drift=(1-q)*Math.sin(p.time*.40)*4;
    const src=this.targets[kind];
    const v=[];
    for(let i=0;i<src.length;i++) {
      const raw=src[i], u=raw.u;
      const angle=3*Math.PI*u*q;
      const x0=(u-.5)*span+(blue?5.85:-5.85)*s*p.settle;
      const xf=(raw.x-110.45)*s;
      const y0=sign*radius*Math.cos(angle);
      const yf=(raw.y-100.8)*s;
      const ambient=(1-q)*Math.sin((u-.5)*Math.PI*.65-p.time*.34)*12;
      const materialRoll=roll+(1-q)*q*.16*Math.sin(angle);
      const x=cx+lerp(x0,xf,fit);
      v.push({x,y:this.h/2+lerp(y0,yf,fit)+ambient+drift,
        hx:half*Math.sin(materialRoll),hy:half*Math.cos(materialRoll),
        z:-sign*radius*Math.sin(angle),angle,u});
    }
    {
      // Keep the central winding consistent while the long trailing end feeds in.
      const segments=[];
      for(let i=1;i<v.length;i++) {
        const a=v[i-1],b=v[i];
        segments.push({dx2:(b.x-a.x)**2,transverse2:(b.y-a.y)**2+(b.z-a.z)**2});
      }
      let low=0,high=length/span+1;
      for(let step=0;step<18;step++) {
        const stretch=(low+high)/2;
        let arc=0;
        for(const segment of segments)arc+=Math.sqrt(segment.dx2*stretch*stretch+segment.transverse2);
        if(arc<length)low=stretch;else high=stretch;
      }
      const stretch=(low+high)/2;
      const center=(v[0].x+v[v.length-1].x)/2;
      for(const point of v)point.x=center+(point.x-center)*stretch;
    }
    // A long, finite trailing end feeds in from the entry side until the last coils.
    const tail=[];
    if(p.enter<1) {
      const left=blue,a=left?v[0]:v[v.length-1],b=left?v[1]:v[v.length-2];
      const direction=left?-1:1;
      const ms=p.time*1000,start=this.enter-this.entryTravel;
      const arrival=smoother(range(ms,start,this.enter));
      const feed=smoother(range(ms,0,start));
      const distanceToEdge=left?a.x:this.w-a.x;
      // Use the same offscreen share of the trip as the arriving head.
      const clearance=Math.max(0,distanceToEdge)*(6.923*s+40)/(this.w/2+length/2);
      const waitingExtent=lerp(this.w*1.55+this.logoWidth*2,Math.max(0,distanceToEdge)+clearance,feed);
      const extent=waitingExtent*(1-arrival);
      const slope=(a.y-b.y)/(a.x-b.x);
      const fall=Math.max(this.logoWidth*.8,180);
      const count=Math.ceil(extent/8);
      for(let i=1;i<=count;i++) {
        const distance=extent*i/count,dx=direction*distance;
        const materialRoll=lerp(roll,0,smoother(range(distance,0,fall)));
        const bend=(1-Math.exp(-distance/fall))**2*(1-q)*12*Math.sin(p.time*.4);
        tail.push({x:a.x+dx,y:a.y+slope*dx*Math.exp(-distance/fall)+bend,
          hx:half*Math.sin(materialRoll),hy:half*Math.cos(materialRoll),
          z:a.z,angle:a.angle,u:left?-distance/length:1+distance/length});
      }
    }
    const all=blue?[...tail.reverse(),...v]:[...v,...tail];
    for(let i=0;i<all.length;i++) {
      const a=all[Math.max(0,i-1)],b=all[Math.min(all.length-1,i+1)],o=all[i];
      o.cross=(b.x-a.x)*o.hy-(b.y-a.y)*o.hx;
      o.plus={x:o.x+o.hx,y:o.y+o.hy};o.minus={x:o.x-o.hx,y:o.y-o.hy};
    }
    return all;
  }
  path(c,v,start=0,end=v.length-1) {
    c.beginPath();c.moveTo(v[start].minus.x,v[start].minus.y);
    for(let i=start+1;i<=end;i++)c.lineTo(v[i].minus.x,v[i].minus.y);
    for(let i=end;i>=start;i--)c.lineTo(v[i].plus.x,v[i].plus.y);
    c.closePath();
  }
  edges(c,v,start,end) {
    c.beginPath();c.moveTo(v[start].minus.x,v[start].minus.y);
    for(let i=start+1;i<=end;i++)c.lineTo(v[i].minus.x,v[i].minus.y);
    c.moveTo(v[start].plus.x,v[start].plus.y);
    for(let i=start+1;i<=end;i++)c.lineTo(v[i].plus.x,v[i].plus.y);
    c.stroke();
    c.beginPath();
    if(start===0) {
      c.moveTo(v[start].minus.x,v[start].minus.y);c.lineTo(v[start].plus.x,v[start].plus.y);
    }
    if(end===v.length-1) {
      c.moveTo(v[end].minus.x,v[end].minus.y);c.lineTo(v[end].plus.x,v[end].plus.y);
    }
    c.stroke();
  }
  drawSurface(layer,v,kind,p,frontOnly=false) {
    const c=layer.ctx;c.clearRect(0,0,this.w,this.h);
    c.lineJoin='round';c.lineCap='butt';
    c.lineWidth=lerp(1.35,2*this.scale,p.wind);
    c.strokeStyle='#221815';c.fillStyle=kind==='blue'?'#062479':'#e33671';
    if(frontOnly) {
      let start=-1;
      for(let i=0;i<v.length;i++) {
        const front=v[i].z>.001;
        if(front&&start<0)start=i;
        if(start>=0&&(!front||i===v.length-1)) {
          const end=i;
          this.path(c,v,start,end);c.fill();this.edges(c,v,start,end);
          start=-1;
        }
      }
    } else {
      this.path(c,v);c.fill();
      if(kind==='pink') {
        c.fillStyle='#ffffff';let start=-1;
        for(let i=0;i<v.length;i++) {
          const back=v[i].cross<0;
          if(back&&start<0)start=Math.max(0,i-1);
          if(start>=0&&(!back||i===v.length-1)) {
            this.path(c,v,start,i);c.fill();start=-1;
          }
        }
      }
      this.edges(c,v,0,v.length-1);
    }
  }
  mask(c,kind,p,v) {
    if(p.focus>0) {
      // Match the final SVG outline without hiding the moving ribbon ends.
      c.save();c.globalCompositeOperation='destination-out';c.globalAlpha=p.focus;
      const mask=this.masks.find(mask=>mask.kind===kind);
      c.drawImage(mask.canvas,0,0,this.w,this.h);c.restore();
    }
    const ms=p.time*1000,transition=this.enter*.10;
    const headFade=1-smoother(range(ms,this.entryTravel-transition,this.entryTravel));
    const tailFade=p.endFade;
    const fades=kind==='blue'?[tailFade,headFade]:[headFade,tailFade];
    if(fades[0]<=0&&fades[1]<=0)return;
    this.fadeEnds(c,v,fades);
  }
  fadeTriangle(c,a,b,d,alphaA,alphaB,alphaD) {
    const bx=b.x-a.x,by=b.y-a.y,dx=d.x-a.x,dy=d.y-a.y;
    const determinant=bx*dy-by*dx;
    if(Math.abs(determinant)<.000001)return;
    // Interpolate opacity in ribbon coordinates, keeping each cross-section uniform.
    const gx=((alphaB-alphaA)*dy-(alphaD-alphaA)*by)/determinant;
    const gy=(bx*(alphaD-alphaA)-dx*(alphaB-alphaA))/determinant;
    const magnitude=gx*gx+gy*gy;
    if(magnitude<.0000000001)c.fillStyle=`rgb(${alphaA*255} ${alphaA*255} ${alphaA*255})`;
    else {
      const gradient=c.createLinearGradient(a.x-gx*alphaA/magnitude,a.y-gy*alphaA/magnitude,
        a.x+gx*(1-alphaA)/magnitude,a.y+gy*(1-alphaA)/magnitude);
      gradient.addColorStop(0,'#000');gradient.addColorStop(1,'#fff');
      c.fillStyle=gradient;
    }
    // Overlap adjacent opaque mask triangles slightly to avoid antialiasing seams.
    const perimeter=Math.hypot(bx,by)+Math.hypot(dx,dy)+Math.hypot(d.x-b.x,d.y-b.y);
    const expand=Math.min(4,1+.65/this.dpr/(Math.abs(determinant)/perimeter));
    const cx=(a.x+b.x+d.x)/3,cy=(a.y+b.y+d.y)/3;
    c.beginPath();
    for(const [i,point] of [a,b,d].entries()) {
      const x=cx+(point.x-cx)*expand,y=cy+(point.y-cy)*expand;
      if(i===0)c.moveTo(x,y);else c.lineTo(x,y);
    }
    c.closePath();c.fill();
  }
  fadeEnds(target,v,fades) {
    const c=this.fadeMask.ctx,feather=this.logoWidth*.12;
    const strips=[];
    for(let end=0;end<2;end++) {
      const strength=fades[end];if(strength<=0)continue;
      const first=end?v.length-1:0,step=end?-1:1;
      const sections=[{point:v[first],alpha:strength}];
      let distance=0;
      for(let i=first+step;i>=0&&i<v.length;i+=step) {
        const a=v[i-step],b=v[i],segment=Math.hypot(b.x-a.x,b.y-a.y);
        if(segment<.000001)continue;
        const t=Math.min(1,(feather-distance)/segment);
        const point=t===1?b:{
          minus:{x:lerp(a.minus.x,b.minus.x,t),y:lerp(a.minus.y,b.minus.y,t)},
          plus:{x:lerp(a.plus.x,b.plus.x,t),y:lerp(a.plus.y,b.plus.y,t)}
        };
        distance+=segment*t;
        sections.push({point,alpha:strength*(1-smoother(distance/feather))});
        if(distance>=feather)break;
      }
      strips.push(sections);
    }
    // Render a small luminance mask per end, then convert it to alpha once.
    // Opaque mask interpolation avoids accumulated opacity along mesh seams.
    for(const sections of strips) {
      const margin=target.lineWidth/2+2/this.dpr;
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(const {point} of sections)for(const side of ['minus','plus']) {
        left=Math.min(left,point[side].x);right=Math.max(right,point[side].x);
        top=Math.min(top,point[side].y);bottom=Math.max(bottom,point[side].y);
      }
      left=Math.max(0,Math.floor(left-margin));top=Math.max(0,Math.floor(top-margin));
      right=Math.min(this.w,Math.ceil(right+margin));bottom=Math.min(this.h,Math.ceil(bottom+margin));
      if(right<=left||bottom<=top)continue;
      this.fadeMask.canvas.width=Math.ceil((right-left)*this.dpr);
      this.fadeMask.canvas.height=Math.ceil((bottom-top)*this.dpr);
      c.setTransform(this.dpr,0,0,this.dpr,-left*this.dpr,-top*this.dpr);
      c.fillStyle='#000';c.fillRect(left,top,right-left,bottom-top);
      c.globalCompositeOperation='lighten';c.lineCap='butt';c.lineWidth=target.lineWidth+2/this.dpr;
      const start=sections[0],shade=start.alpha*255;
      c.strokeStyle=`rgb(${shade} ${shade} ${shade})`;
      c.beginPath();c.moveTo(start.point.minus.x,start.point.minus.y);
      c.lineTo(start.point.plus.x,start.point.plus.y);c.stroke();
      for(let i=1;i<sections.length;i++)for(const side of ['minus','plus']) {
        const a=sections[i-1],b=sections[i],from=a.point[side],to=b.point[side];
        if(Math.hypot(to.x-from.x,to.y-from.y)<.000001)continue;
        const gradient=c.createLinearGradient(from.x,from.y,to.x,to.y);
        const fromShade=a.alpha*255,toShade=b.alpha*255;
        gradient.addColorStop(0,`rgb(${fromShade} ${fromShade} ${fromShade})`);
        gradient.addColorStop(1,`rgb(${toShade} ${toShade} ${toShade})`);
        c.strokeStyle=gradient;c.beginPath();c.moveTo(from.x,from.y);c.lineTo(to.x,to.y);c.stroke();
      }
      for(let i=1;i<sections.length;i++) {
        const a=sections[i-1],b=sections[i];
        this.fadeTriangle(c,a.point.minus,a.point.plus,b.point.plus,a.alpha,a.alpha,b.alpha);
        this.fadeTriangle(c,a.point.minus,b.point.plus,b.point.minus,a.alpha,b.alpha,b.alpha);
      }
      const pixels=c.getImageData(0,0,this.fadeMask.canvas.width,this.fadeMask.canvas.height);
      for(let i=0;i<pixels.data.length;i+=4) {
        pixels.data[i+3]=pixels.data[i];pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=0;
      }
      c.putImageData(pixels,0,0);
      target.save();target.globalCompositeOperation='destination-out';
      target.drawImage(this.fadeMask.canvas,left,top,this.fadeMask.canvas.width/this.dpr,this.fadeMask.canvas.height/this.dpr);
      target.restore();
    }
  }
  drawExact(c=this.ctx,image=this.mark) {
    if(!image.complete||!image.naturalWidth)return;
    const s=this.scale;
    c.drawImage(image,this.w/2+(40.8-110.45)*s,this.h/2+(83.3-100.8)*s,139.3*s,35*s);
  }
  render(ms) {
    this.lastTime=ms;
    const c=this.ctx;c.clearRect(0,0,this.w,this.h);
    const p=this.parameters(ms);
    // Play the same logo intro across devices, including reduced-motion environments.
    const blue=this.vertices('blue',p),pink=this.vertices('pink',p);
    this.drawSurface(this.layers[0],blue,'blue',p);
    this.drawSurface(this.layers[1],pink,'pink',p);
    this.drawSurface(this.layers[2],blue,'blue',p,true);
    // A translucent blue face must be composited once, at its proper depth.
    const back=this.layers[0].ctx;
    back.save();back.globalCompositeOperation='destination-out';
    back.drawImage(this.layers[2].canvas,0,0,this.w,this.h);back.restore();
    this.mask(back,'blue',p,blue);
    this.mask(this.layers[1].ctx,'pink',p,pink);
    this.mask(this.layers[2].ctx,'blue',p,blue);
    for(const layer of this.layers)c.drawImage(layer.canvas,0,0,this.w,this.h);
    this.root.style.opacity=String(1-smoother(p.exit));
    const fading=this.exitAt!==null&&ms>=this.exitAt;
    this.root.dataset.phase=fading?'fadeout':ms<this.enter?'intertwine':'hold';
  }
  async play({ready=Promise.resolve(),minimumDuration=this.enter+this.hold}={}) {
    const token=++this.token;
    cancelAnimationFrame(this.raf);
    if(this.resolveFinished){this.resolveFinished();this.resolveFinished=null;}
    this.running=true;this.isReady=false;this.readyAt=null;this.exitAt=null;this.start=null;
    this.minimumDuration=minimumDuration;
    this.root.hidden=false;this.root.style.opacity='1';
    this.page.inert=true;this.page.setAttribute('aria-busy','true');
    this.liveStatus.textContent=this.root.getAttribute('aria-label')||'読み込んでいます。';
    this.lastTime=0;this.resize();
    await this.markReady;
    if(token!==this.token)return;
    this.start=performance.now();
    Promise.resolve(ready).catch(()=>{}).then(()=>{if(token===this.token)this.finish();});
    const finished=new Promise(resolve=>{this.resolveFinished=resolve;});
    this.raf=requestAnimationFrame(this.frame);
    return finished;
  }
  frame(now) {
    if(!this.running)return;
    const t=(now-this.start)*this.speed;
    if(this.exitAt===null&&this.isReady&&t>=this.minimumDuration)
      this.exitAt=Math.max(this.minimumDuration,this.readyAt);
    if(this.exitAt!==null&&t>=this.exitAt+this.leave){this.dismiss();return;}
    this.render(t);this.raf=requestAnimationFrame(this.frame);
  }
  finish(){if(this.isReady)return;this.isReady=true;this.readyAt=this.start===null?0:(performance.now()-this.start)*this.speed;}
  dismiss() {
    this.running=false;++this.token;cancelAnimationFrame(this.raf);
    this.root.hidden=true;this.root.style.opacity='0';
    this.page.inert=false;this.page.setAttribute('aria-busy','false');
    this.liveStatus.textContent='読み込みが完了しました。';
    if(this.resolveFinished){this.resolveFinished();this.resolveFinished=null;}
    window.dispatchEvent(new CustomEvent('shugilab:ready'));
  }
  seek(ms) {
    cancelAnimationFrame(this.raf);this.running=false;
    this.root.hidden=false;this.exitAt=this.enter+this.hold;this.render(ms);
    if(ms>=this.exitAt+this.leave)this.dismiss();
  }
}
