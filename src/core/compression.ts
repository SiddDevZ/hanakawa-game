// fetch already decodes Content-Encoding; static hosts without that header return gzip bytes.
export async function unpackGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (header[0] !== 0x1f || header[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
