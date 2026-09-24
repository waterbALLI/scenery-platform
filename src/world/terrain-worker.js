import { createField } from './terrain.js';
const cache=new Map();
self.onmessage=({data})=>{
  const {id,cx,cz,config}=data;
  try {
    const key=`${config.algorithm}:${config.scale}:${cx}:${cz}`;
    let field=cache.get(key);
    if(!field) { field=createField(cx,cz,config); cache.set(key,field); }
    if(cache.size>40) cache.delete(cache.keys().next().value);
    const copy={...field,heights:field.heights.slice()};
    self.postMessage({id,field:copy},[copy.heights.buffer]);
  } catch(error) { self.postMessage({id,error:error.message}); }
};
