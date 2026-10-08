/** Shared project file boundary for native tools and the existing attachment picker. */
const secret=/(^|[\\/])(\.env(?:\.[^/\\]*)?|[^/\\]*\.env|[^/\\]*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|auth\.json|credentials\.json)$/i;
export const secretProjectPath=(path:string)=>secret.test(path);
