import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, stat, symlink, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { SystemCredentialVault, type StorageCipher } from "./credential-vault.js";
const key=randomBytes(32);
// Injectable cipher exercises storage mechanics; OS safeStorage is tested separately in Electron.
const cipher:StorageCipher={isEncryptionAvailable:()=>true,encryptString(value){
 const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",key,iv);const data=Buffer.concat([c.update(value),c.final()]);return Buffer.concat([iv,data,c.getAuthTag()]);
},decryptString(value){const c=createDecipheriv("aes-256-gcm",key,value.subarray(0,12),{authTagLength:16});c.setAuthTag(value.subarray(-16));return Buffer.concat([c.update(value.subarray(12,-16)),c.final()]).toString();}};
test("credential vault encrypts atomically, refuses malformed/symlink files, clears local state",async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),"mx-vault-"));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,"session.bin"),vault=new SystemCredentialVault(path,cipher);
 assert.equal(await vault.read(),null);const record={origin:"https://identity.example.invalid",refreshToken:"synthetic-fixture-refresh"};
 await vault.write(record);assert.deepEqual(await vault.read(),record);assert.ok(!(await readFile(path)).includes(record.refreshToken));
 if(process.platform!=="win32")assert.equal((await stat(path)).mode&0o777,0o600);
 await writeFile(path,"corrupt fixture");await assert.rejects(vault.read(),/加密登录记录不可读取/);await vault.clear();
 if(process.platform!=="win32"){const target=join(dir,"target");await writeFile(target,"fixture");await symlink(target,path);await assert.rejects(vault.read(),/加密登录记录不可读取/);await vault.clear();}
 assert.equal(await vault.read(),null);
});
test("credential vault rejects unavailable OS encryption and Linux basic_text",async()=>{
 for(const c of [{...cipher,isEncryptionAvailable:()=>false},{...cipher,getSelectedStorageBackend:()=>"basic_text"}]){
  const vault=new SystemCredentialVault("unused-fixture-path",c);assert.equal(vault.available(),false);
  await assert.rejects(vault.write({origin:"https://fixture.invalid",refreshToken:"fixture"}),/安全凭据存储不可用/);
 }
});
