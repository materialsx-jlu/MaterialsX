import {resolve} from 'node:path';
const overrides=new Map<string,string>();
/** Only the main-process managed runtime verifier sets this map; no model-supplied path. */
export function configureManagedPython(root:string,path:string){overrides.set(resolve(root),path);process.env.MATERIALSX_PYTHON=path;process.env.PYTHONNOUSERSITE='1';process.env.PYTHONDONTWRITEBYTECODE='1';}
export function managedPython(root:string){return overrides.get(resolve(root));}
