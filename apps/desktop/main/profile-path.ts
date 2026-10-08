import {isAbsolute,resolve} from 'node:path';
import {mkdirSync,lstatSync,realpathSync} from 'node:fs';
/** Optional isolated/portable local profile; never changes the default profile implicitly. */
export function profilePath(value:string|undefined){
 if(!value)return null;
 if(!isAbsolute(value)||resolve(value)===resolve('/'))throw Error('MATERIALSX_PROFILE_PATH must be an absolute non-root directory');
 mkdirSync(value,{recursive:true,mode:0o700});
 if(lstatSync(value).isSymbolicLink()||!lstatSync(value).isDirectory())throw Error('MATERIALSX_PROFILE_PATH must be a real directory');
 return realpathSync(value);
}
