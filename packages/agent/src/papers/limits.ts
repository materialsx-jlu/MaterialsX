/** One policy shared by persistence, downloads, managed repair and storage inventory. */
export const researchLimits={metadataBytes:200*1024*1024,downloadBytes:1024*1024*1024,managedPythonBytes:1024*1024*1024,pdfBytes:50*1024*1024,cacheTtlMs:86400000} as const;
