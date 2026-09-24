import * as THREE from 'three';
import {CHUNK_SIZE as S, WATER_LEVEL, sampleHeight, chooseLOD, clipWaterTriangle, hash, clamp} from './terrain.js';

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    uniforms:{uTime:{value:0},uSpeed:{value:1},uLight:{value:1},uSun:{value:new THREE.Vector3(.4,.8,.2)}},
    vertexShader:`attribute float depth; varying float vDepth; varying vec3 vWorld;
      void main(){ vDepth=depth; vWorld=(modelMatrix*vec4(position,1.)).xyz;
      gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.); }`,
    fragmentShader:`uniform float uTime; uniform float uSpeed; uniform float uLight; uniform vec3 uSun;
      varying float vDepth; varying vec3 vWorld;
      void main(){
        float t=uTime*uSpeed; vec2 p=vWorld.xz;
        // 多频正弦导数生成动态法线，几何水位不动，岸边不会上下穿插。
        float dx=.065*cos(p.x*.9+t)+.04*cos((p.x+p.y)*1.7-t*1.2);
        float dz=.07*cos(p.y*1.1-t*.8)+.04*cos((p.x+p.y)*1.7-t*1.2);
        vec3 n=normalize(vec3(-dx,1.,-dz)); vec3 v=normalize(cameraPosition-vWorld);
        float fresnel=.02+.98*pow(1.-max(dot(n,v),0.),5.);
        vec3 shallow=vec3(.12,.42,.38), deep=vec3(.025,.13,.20);
        vec3 color=mix(shallow,deep,1.-exp(-vDepth*.75));
        vec3 reflectedSky=mix(vec3(.27,.42,.48),vec3(.65,.79,.8),max(reflect(-v,n).y,0.));
        color=mix(color,reflectedSky,fresnel*.8);
        float spec=pow(max(dot(n,normalize(v+uSun)),0.),100.);
        float foam=(1.-smoothstep(.02,.35,vDepth))*(.45+.55*sin(p.x*4.+p.y*3.-t*2.));
        color=(color+spec*.8+max(0.,foam)*.35)*(.12+.88*uLight);
        gl_FragColor=vec4(color,mix(.48,.94,1.-exp(-vDepth)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class StreamingWorld {
  constructor(scene) {
    this.scene=scene; this.chunks=new Map(); this.config={algorithm:'waves',scale:1};
    this.maxSegments=64; this.autoLOD=true; this.version=0; this.queue=[]; this.pending=null; this.ready=null;
    this.serial=0; this.wireframe=false; this.showCollisions=false; this.lastPlan=-1;
    this.worker=new Worker(new URL('./terrain-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=> { if(this.pending?.id===data.id) { this.ready={...this.pending,...data}; this.pending=null; } };
    this.worker.onerror=e=>{this.error=e.message;this.pending=null;};
    this.groundMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95});
    this.wireMat=new THREE.MeshBasicMaterial({wireframe:true,color:0xb9e6b4,transparent:true,opacity:.24,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
    this.waterMat=waterMaterial();
    this.geos={trunk:new THREE.CylinderGeometry(.17,.25,1,6),pine:new THREE.ConeGeometry(1,1,7),leaf:new THREE.IcosahedronGeometry(1,1),rock:new THREE.DodecahedronGeometry(1),grass:new THREE.ConeGeometry(.15,1,4)};
    this.mats={trunk:new THREE.MeshStandardMaterial({color:0x69503c}),pine:new THREE.MeshStandardMaterial({color:0x315c47,roughness:1}),leaf:new THREE.MeshStandardMaterial({color:0x658348,roughness:1}),rock:new THREE.MeshStandardMaterial({color:0x889184,roughness:1}),grass:new THREE.MeshStandardMaterial({color:0x879a54,roughness:1}),wood:new THREE.MeshStandardMaterial({color:0x987252}),roof:new THREE.MeshStandardMaterial({color:0x334a48}),base:new THREE.MeshStandardMaterial({color:0x6c7167}),window:new THREE.MeshStandardMaterial({color:0xe0c593,emissive:0x614018,emissiveIntensity:.3})};
  }
  configure(config) { this.config={...this.config,...config}; this.version++; this.queue=[]; this.ready=null; this.lastPlan=-1; }
  fieldAt(x,z) { return this.chunks.get(`${Math.floor(x/S)},${Math.floor(z/S)}`); }
  height(x,z) { const c=this.fieldAt(x,z); return c?sampleHeight(c.field,x,z):null; }
  canWalk(x,z) {
    const c=this.fieldAt(x,z),y=this.height(x,z);
    if(!c || y===null || y<WATER_LEVEL+.12) return false;
    return !c.colliders.some(b=>x>b.min.x-.4 && x<b.max.x+.4 && z>b.min.z-.4 && z<b.max.z+.4);
  }
  plan(camera, now) {
    if(now-this.lastPlan<.2 && this.lastPlan>=0) return;
    this.lastPlan=now;
    const cx=Math.floor(camera.position.x/S),cz=Math.floor(camera.position.z/S),wanted=new Set();
    const elevation=this.height(camera.position.x,camera.position.z)??0;
    const altitude=Math.max(1,camera.position.y-elevation);
    // 5×5 块 = 220×220 世界单位，中心随观察者移动。
    const jobs=[];
    for(let dz=-2;dz<=2;dz++) for(let dx=-2;dx<=2;dx++) {
      const x=cx+dx,z=cz+dz,key=`${x},${z}`,old=this.chunks.get(key);wanted.add(key);
      const distance=Math.hypot((x+.5)*S-camera.position.x,(z+.5)*S-camera.position.z);
      const segments=this.autoLOD?chooseLOD(this.maxSegments,altitude,distance,old?.segments):this.maxSegments;
      if(!old || old.version!==this.version || old.segments!==segments) jobs.push({cx:x,cz:z,key,segments,version:this.version,distance});
    }
    this.wanted=wanted;
    jobs.sort((a,b)=>a.distance-b.distance);
    this.queue=jobs.filter(j=>!(this.pending?.key===j.key&&this.pending.version===j.version&&this.pending.segments===j.segments)&&!(this.ready?.key===j.key&&this.ready.version===j.version&&this.ready.segments===j.segments));
    for(const [key,c] of this.chunks) if(!wanted.has(key)){this.dispose(c);this.chunks.delete(key);}
  }
  update(camera, now) {
    this.plan(camera,now);
    if(this.ready) {
      const result=this.ready;this.ready=null;
      if(result.error) this.error=result.error;
      else if(result.version===this.version&&this.wanted.has(result.key)) {
        const chunk=this.createChunk(result);
        const old=this.chunks.get(result.key); if(old)this.dispose(old);
        this.chunks.set(result.key,chunk);this.scene.add(chunk.group);
      }
    }
    if(!this.pending && !this.ready && this.queue.length && !this.error) {
      const job=this.queue.shift(); this.pending={...job,id:++this.serial};
      this.worker.postMessage({...this.pending,config:this.config});
    }
    this.waterMat.uniforms.uTime.value=now;
  }
  createChunk({field,segments:n,version}) {
    const positions=[],colors=[],indices=[],water=[],depth=[],stride=n+1;
    const originX=field.cx*S,originZ=field.cz*S;
    const color=new THREE.Color();
    for(let z=0;z<=n;z++)for(let x=0;x<=n;x++){
      const wx=originX+x*S/n,wz=originZ+z*S/n,h=sampleHeight(field,wx,wz);
      positions.push(x*S/n,h,z*S/n);
      const slope=Math.hypot(sampleHeight(field,wx+.4,wz)-sampleHeight(field,wx-.4,wz),sampleHeight(field,wx,wz+.4)-sampleHeight(field,wx,wz-.4))/.8;
      color.set(h<.7?0xa1a078:slope>1.15?0x7c8377:h>19?0x9aa18c:0x63835a);
      color.multiplyScalar(.9+hash(Math.floor(wx*2),Math.floor(wz*2))*.12);
      colors.push(color.r,color.g,color.b);
    }
    const vertex=i=>positions.slice(i*3,i*3+3);
    const addTriangle=(a,b,c)=>{
      indices.push(a,b,c);
      const poly=clipWaterTriangle([vertex(a),vertex(b),vertex(c)]);
      for(let k=1;k<poly.length-1;k++)for(const v of [poly[0],poly[k],poly[k+1]]){
        water.push(v[0],WATER_LEVEL+.012,v[2]);depth.push(Math.max(0,WATER_LEVEL-v[1]));
      }
    };
    for(let z=0;z<n;z++)for(let x=0;x<n;x++){const a=z*stride+x,b=a+1,c=a+stride,d=c+1;addTriangle(a,c,b);addTriangle(b,c,d);}
    // 裙边覆盖相邻不同 LOD 的 T 接缝；同级边界共享全局高度。
    const edges=[Array.from({length:stride},(_,i)=>i),Array.from({length:stride},(_,i)=>i*stride+n),Array.from({length:stride},(_,i)=>n*stride+n-i),Array.from({length:stride},(_,i)=>(n-i)*stride)];
    for(const edge of edges) for(let i=0;i<n;i++){
      const a=edge[i],b=edge[i+1],ka=positions.length/3;
      for(const j of [a,b]){const p=vertex(j);positions.push(p[0],p[1]-4,p[2]);colors.push(...colors.slice(j*3,j*3+3));}
      indices.push(a,b,ka,a,ka,ka+1);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const group=new THREE.Group();group.position.set(originX,0,originZ);
    const ground=new THREE.Mesh(geometry,this.groundMat);ground.receiveShadow=true;group.add(ground);
    const wire=new THREE.Mesh(geometry,this.wireMat);wire.visible=this.wireframe;group.add(wire);
    const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(water,3));wg.setAttribute('depth',new THREE.Float32BufferAttribute(depth,1));
    const waterMesh=new THREE.Mesh(wg,this.waterMat);waterMesh.renderOrder=2;group.add(waterMesh);
    const chunk={group,geometry,waterGeometry:wg,wire,field,segments:n,version,colliders:[],helpers:[],instances:0};
    this.decorate(chunk);return chunk;
  }
  decorate(chunk) {
    const {field,segments:n,group}=chunk,ox=field.cx*S,oz=field.cz*S;
    const h=(x,z)=>sampleHeight(field,ox+x,oz+z);
    const batches={trunk:[],pine:[],leaf:[],rock:[],grass:[]};
    const rand=(i,s)=>hash(field.cx*1009+i,field.cz*1013+s,s);
    let site=null;
    // 林间小屋避开水域、陡坡；地基覆盖整个底面，不随坡面倾斜。
    if((field.cx===0&&field.cz===0)||hash(field.cx,field.cz,87)>.9){
      for(let i=0;i<20;i++){
        const x=7+rand(i,81)*30,z=7+rand(i,82)*30,samples=[];
        for(let dz=-3;dz<=3;dz+=1.5)for(let dx=-4;dx<=4;dx+=2)samples.push(h(x+dx,z+dz));
        const low=Math.min(...samples),high=Math.max(...samples);
        if(low>1.2&&high-low<2.6){site={x,z,low,high};break;}
      }
    }
    if(site){
      const {x,z,low,high}=site,floor=high+.16;
      const box=(w,y,d,px,py,pz,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,y,d),mat);m.position.set(px,py,pz);m.castShadow=true;m.receiveShadow=true;group.add(m);};
      box(8, floor-low+.5,6,x,(floor+low-.5)/2,z,this.mats.base);
      box(7.3,3.3,5.3,x,floor+1.65,z,this.mats.wood);
      const roof=new THREE.Mesh(new THREE.ConeGeometry(5.7,2.1,4),this.mats.roof);roof.rotation.y=Math.PI/4;roof.scale.z=.75;roof.position.set(x,floor+4.3,z);roof.castShadow=true;group.add(roof);
      box(1.1,2.25,.16,x,floor+1.125,z-2.72,this.mats.trunk);
      for(const dx of [-2.2,2.2])box(1.2,1.05,.16,x+dx,floor+2.05,z-2.72,this.mats.window);
      box(.7,2,.7,x+2.3,floor+4.9,z+.7,this.mats.base);
      for(let i=0;i<4;i++)box(2.1,.25,1.2,x,h(x,z-4-i)+.06,z-4-i,this.mats.base);
      const collider=new THREE.Box3(new THREE.Vector3(ox+x-4,low,oz+z-3),new THREE.Vector3(ox+x+4,floor+5.5,oz+z+3));chunk.colliders.push(collider);
      const helper=new THREE.Box3Helper(collider,0xffb56b);helper.position.set(-ox,0,-oz);helper.visible=this.showCollisions;chunk.helpers.push(helper);group.add(helper);
    }
    for(let i=0;i<100;i++){
      const x=1+rand(i,2)*(S-2),z=1+rand(i,3)*(S-2),y=h(x,z);
      if(site&&Math.abs(x-site.x)<6&&Math.abs(z-site.z)<9)continue;
      if(y<.1)continue;
      const slope=Math.abs(h(x+.6,z)-h(x-.6,z))+Math.abs(h(x,z+.6)-h(x,z-.6));
      if(i<44&&y>1.3&&slope<1.4){
        const height=4+rand(i,4)*4.5,broad=rand(i,5)>.58;
        batches.trunk.push([x,y+height*.2-.1,z,.8,height*.4, .8]);
        batches[broad?'leaf':'pine'].push([x,y+height*.62,z,height*.25,broad?height*.33:height*.8,height*.25]);
      }else if(i<70){const s=.3+rand(i,6)*1.1;batches.rock.push([x,y-.1,z,s,s*.65,s*.85]);}
      else {const s=y<1.4?1.2:.5;batches.grass.push([x,y+s*.5-.06,z,1,s,1]);}
    }
    const dummy=new THREE.Object3D();
    for(const [kind,items] of Object.entries(batches)){
      if(!items.length)continue;
      const mesh=new THREE.InstancedMesh(this.geos[kind],this.mats[kind],items.length);
      items.forEach(([x,y,z,sx,sy,sz],i)=>{dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(0,rand(i,19)*Math.PI*2,0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
      mesh.castShadow=kind!=='grass';mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);chunk.instances+=items.length;
    }
  }
  dispose(chunk) {
    this.scene.remove(chunk.group);
    const shared=new Set(Object.values(this.geos)),disposed=new Set();
    chunk.group.traverse(o=>{
      if(o.geometry&&!shared.has(o.geometry)&&!disposed.has(o.geometry)){o.geometry.dispose();disposed.add(o.geometry);}
      if(o.isBox3Helper)o.material.dispose();
    });
  }
  setWireframe(value){this.wireframe=value;for(const c of this.chunks.values())c.wire.visible=value;}
  setCollisions(value){this.showCollisions=value;for(const c of this.chunks.values())for(const h of c.helpers)h.visible=value;}
  stats(){return {chunks:this.chunks.size,queued:this.queue.length+Number(!!this.pending)+Number(!!this.ready),triangles:[...this.chunks.values()].reduce((a,c)=>a+c.geometry.index.count/3,0),lods:[...new Set([...this.chunks.values()].map(c=>c.segments))].sort((a,b)=>b-a),instances:[...this.chunks.values()].reduce((a,c)=>a+c.instances,0),version:this.version,error:this.error??null};}
}
