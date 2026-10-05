process.env.MATERIALSX_DISCOVERY_AUTOSYNC='0';
const {app,safeStorage}=require("electron");
const {mkdtempSync,rmSync}=require("node:fs");const {tmpdir}=require("node:os");const {join}=require("node:path");
const dir=mkdtempSync(join(tmpdir(),"mx-safe-storage-"));app.setPath("userData",dir);
app.whenReady().then(()=>{
 try{if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==="basic_text")throw new Error("secure OS storage unavailable");
 const fixture="MaterialsX synthetic storage fixture only";const encrypted=safeStorage.encryptString(fixture);
 if(encrypted.includes(fixture)||safeStorage.decryptString(encrypted)!==fixture)throw new Error("storage roundtrip failed");
 console.log(JSON.stringify({platform:process.platform,electron:process.versions.electron,encrypted:true,roundtrip:true,fixtureOnly:true}));
 rmSync(dir,{recursive:true,force:true});app.exit(0);
 }catch{console.error("M5.1 secure OS storage verification failed");rmSync(dir,{recursive:true,force:true});app.exit(1);}
});
app.on("will-quit",()=>rmSync(dir,{recursive:true,force:true}));
