declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
  }
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}
