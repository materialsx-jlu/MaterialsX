import {readdir,lstat,readlink,unlink,symlink,rm} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
/** The Python distribution's convenience aliases must point to sibling files in the packaged runtime. */
export async function normalizeRuntimeLinks(root:string){
  async function visit(dir:string){for(const name of await readdir(dir)){const path=join(dir,name),s=await lstat(path);if(s.isDirectory())await visit(path);else if(s.isSymbolicLink()){
    const link=await readlink(path);if(resolve(dir,link).startsWith(resolve(root)+'/'))continue;
    const sibling=join(dir,basename(link));const target=await lstat(sibling);if(!target.isFile()||target.isSymbolicLink())throw Error('RUNTIME_EXTERNAL_SYMLINK');await unlink(path);await symlink(basename(link),path);
  }}}await visit(root);
}

export async function removeRuntimeBytecode(root:string){
  async function visit(dir:string){for(const name of await readdir(dir)){const path=join(dir,name),s=await lstat(path);if(name==='__pycache__'||name.endsWith('.pyc'))await rm(path,{recursive:true,force:true});else if(s.isDirectory()&&!s.isSymbolicLink())await visit(path);}}await visit(root);
}
