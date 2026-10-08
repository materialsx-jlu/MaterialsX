/** Lossless serialization repair only; facts, metrics, IDs and mutable permissions are never guessed. */
export function proposalFormat(input:unknown,schema:any):unknown{
  if(!input||typeof input!=='object'||Array.isArray(input))return input;
  const value=structuredClone(input) as Record<string,any>;
  if(value.goal&&typeof value.goal==='object'&&!Array.isArray(value.goal)&&value.constraints===undefined&&value.goal.constraints!==undefined){
    value.constraints=value.goal.constraints;delete value.goal.constraints;
  }
  const visit=(v:any,s:any):any=>{
    if(s.type==='array'){
      if(typeof v==='string'&&s.items?.type==='string')return [v];
      return Array.isArray(v)?v.map(item=>visit(item,s.items??{})):v;
    }
    if(s.type==='object'&&v&&typeof v==='object'&&!Array.isArray(v)){
      for(const [name,child]of Object.entries(s.properties??{}))if(name in v)v[name]=visit(v[name],child);
    }
    return v;
  };
  return visit(value,schema);
}
