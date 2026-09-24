// 全局坐标 + 固定种子：回到任何已卸载区域都能重现同一地形。
export const CHUNK_SIZE = 44;
export const FIELD_SEGMENTS = 128;
export const WATER_LEVEL = 0;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function hash(x, z, seed = 17) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const gradients = [[1,0],[-1,0],[0,1],[0,-1],[Math.SQRT1_2,Math.SQRT1_2],[-Math.SQRT1_2,Math.SQRT1_2],[Math.SQRT1_2,-Math.SQRT1_2],[-Math.SQRT1_2,-Math.SQRT1_2]];
export function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const dot = (dx, dz) => { const g = gradients[Math.floor(hash(ix + dx, iz + dz) * 8)]; return g[0] * (fx - dx) + g[1] * (fz - dz); };
  return mix(mix(dot(0,0), dot(1,0), fade(fx)), mix(dot(0,1), dot(1,1), fade(fx)), fade(fz)) * 1.7;
}
export function fbm(x, z, octaves = 5) {
  let sum = 0, amp = 1, total = 0;
  for (let i = 0; i < octaves; i++) { sum += noise(x, z) * amp; total += amp; amp *= 0.5; x = x * 2 + 13.1; z = z * 2 - 7.3; }
  return sum / total;
}
export function baseHeight(x, z, algorithm) {
  if (algorithm === 'waves') return Math.sin(x * .055 + .7) * 3.8 + Math.cos(z * .072) * 3.2 + Math.sin((x + z) * .115) * 1.4 + Math.cos((x-z)*.16)*.9 + Math.sin(x*.31)*Math.cos(z*.23)*.36;
  if (algorithm === 'ridged') {
    let sum = 0, amp = 1, freq = .017, weight = 1;
    for (let i=0;i<5;i++) { let r = 1 - Math.abs(noise(x*freq+9, z*freq-3)); r *= r * weight; weight = clamp(r*2,0,1); sum += r*amp; amp *= .5; freq *= 2; }
    return (sum - 1) * 17;
  }
  if (algorithm === 'domain') {
    const u = fbm(x*.018+7,z*.018-4,3)*26, v=fbm(x*.018-11,z*.018+8,3)*26;
    return fbm((x+u)*.025,(z+v)*.025)*19;
  }
  return fbm(x*.024+4.6,z*.024+8.2)*21;
}

// 连续河道和确定性湖盆遍布全局；水位保持一致，岸线由地形截面决定。
export function hydrology(x, z, height) {
  const riverX = 19*Math.sin(z*.016) + 9*Math.sin(z*.039);
  let q = Math.abs(x-riverX) / (5.5+1.5*Math.sin(z*.027));
  const cell=176, cx=Math.floor(x/cell), cz=Math.floor(z/cell);
  for(let dz=-1;dz<=1;dz++) for(let dx=-1;dx<=1;dx++) {
    const a=cx+dx, b=cz+dz;
    const lx=a*cell+44+(hash(a,b,31)-.5)*50;
    const lz=b*cell+40+(hash(a,b,37)-.5)*60;
    const rx=17+hash(a,b,41)*13, rz=14+hash(a,b,43)*12;
    const d=Math.hypot((x-lx)/rx,(z-lz)/rz);
    q=Math.min(q,d);
  }
  const bed=-2.7+2.7*smooth(.15,1,q);
  return mix(bed, Math.max(.8,height), smooth(.78,1.7,q));
}

// 热侵蚀：超过休止坡度的物质向最低邻点搬运，双缓冲避免更新方向偏差。
// 周围 halo 宽于迭代次数，保证不同块独立生成后的公共边高度完全一致。
export function thermalErode(input, width, iterations=8, talus=.48) {
  let h = Float64Array.from(input);
  for(let pass=0;pass<iterations;pass++) {
    const delta = new Float64Array(h.length);
    for(let z=1;z<width-1;z++) for(let x=1;x<width-1;x++) {
      const i=z*width+x;
      let j=i;
      for(const k of [i-1,i+1,i-width,i+width]) if(h[k]<h[j]) j=k;
      const amount=Math.max(0,h[i]-h[j]-talus)*.24;
      delta[i]-=amount; delta[j]+=amount;
    }
    for(let i=0;i<h.length;i++) h[i]+=delta[i];
  }
  return h;
}

export function createField(cx, cz, { algorithm='waves', scale=1 }={}) {
  const erosion=algorithm==='erosion', n=erosion?64:FIELD_SEGMENTS, step=CHUNK_SIZE/n;
  const halo=erosion?12:0, width=n+1+2*halo;
  let raw=new Float64Array(width*width);
  for(let z=0;z<width;z++) for(let x=0;x<width;x++) {
    const wx=cx*CHUNK_SIZE+(x-halo)*step, wz=cz*CHUNK_SIZE+(z-halo)*step;
    raw[z*width+x]=baseHeight(wx,wz,algorithm)*scale+8;
  }
  if(erosion) raw=thermalErode(raw,width,8,.48*step);
  const heights=new Float32Array((n+1)**2);
  for(let z=0;z<=n;z++) for(let x=0;x<=n;x++) heights[z*(n+1)+x]=hydrology(cx*CHUNK_SIZE+x*step,cz*CHUNK_SIZE+z*step,raw[(z+halo)*width+x+halo]);
  return { cx, cz, n, heights };
}

// 与网格三角形相同的重心插值，避免树根按连续函数贴地而悬在粗网格上。
export function sampleHeight(field, x, z, segments=field.n) {
  const u=clamp((x-field.cx*CHUNK_SIZE)/CHUNK_SIZE,0,1)*segments;
  const v=clamp((z-field.cz*CHUNK_SIZE)/CHUNK_SIZE,0,1)*segments;
  const ix=Math.min(segments-1,Math.floor(u)), iz=Math.min(segments-1,Math.floor(v));
  const fx=u-ix, fz=v-iz;
  const vertex=(a,b) => {
    const gx=a*field.n/segments,gz=b*field.n/segments;
    const i=Math.min(field.n-1,Math.floor(gx)),j=Math.min(field.n-1,Math.floor(gz));
    const t=gx-i,s=gz-j,k=j*(field.n+1)+i;
    return mix(mix(field.heights[k],field.heights[k+1],t),mix(field.heights[k+field.n+1],field.heights[k+field.n+2],t),s);
  };
  const a=vertex(ix,iz),b=vertex(ix+1,iz),c=vertex(ix,iz+1),d=vertex(ix+1,iz+1);
  return fx+fz<=1 ? a+(b-a)*fx+(c-a)*fz : d+(c-d)*(1-fx)+(b-d)*(1-fz);
}

export function chooseLOD(maxSegments, altitude, distance, previous) {
  const metric=Math.hypot(Math.max(0,altitude),distance*.7);
  const level=metric<38?0:metric<78?1:metric<145?2:3;
  const next=Math.max(16,maxSegments/2**level);
  if(previous && previous!==next) {
    const thresholds=[38,78,145];
    if(thresholds.some(t=>Math.abs(metric-t)<5)) return previous;
  }
  return next;
}

// 用 y=水位 裁剪每个地形三角形，水面轮廓与实际渲染的岸线吻合。
export function clipWaterTriangle(vertices, level=WATER_LEVEL) {
  const output=[];
  for(let i=0;i<3;i++) {
    const a=vertices[i],b=vertices[(i+1)%3],ina=a[1]<level,inb=b[1]<level;
    if(ina) output.push(a);
    if(ina!==inb) { const t=(level-a[1])/(b[1]-a[1]); output.push([mix(a[0],b[0],t),level,mix(a[2],b[2],t)]); }
  }
  return output;
}
