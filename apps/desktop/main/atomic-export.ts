import { nativeImage } from "electron";
/** Decode and re-encode locally; untrusted metadata/chunks are never written verbatim. */
export function cleanAtomicPng(dataUrl:string):Buffer {
  const bytes=Buffer.from(dataUrl.slice("data:image/png;base64,".length),"base64");
  if(bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error("INVALID_PNG");
  if(bytes.length<24||bytes.toString("ascii",12,16)!=="IHDR")throw Error("INVALID_PNG");
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
  if(!w||!h||w>4096||h>4096||w*h>8_000_000)throw Error("PNG_DIMENSION_LIMIT");
  const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error("INVALID_PNG");
  const size=image.getSize();if(size.width!==w||size.height!==h)throw Error("INVALID_PNG");
  const png=image.toPNG();if(png.length>8*1024*1024)throw Error("PNG_SIZE_LIMIT");return png;
}
