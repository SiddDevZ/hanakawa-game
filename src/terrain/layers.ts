// terrain material layers packed into two texture arrays so the whole terrain shader stays well
// under the 16 sampled-texture limit (shadow cascades, environment and caustics need slots too):
//   albedo  (srgb rgba8):   diffuse color
//   surface (linear rgba8): normal.x, normal.y (opengl convention), roughness, ambient occlusion
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, NoColorSpace, UnsignedByteType } from 'three/webgpu';
import type { AssetLoader } from '../core/assets';

export interface LayerSource {
  id: string;
  diffuse: string;
  normal: string;
  /** poly haven arm: r = ao, g = roughness, b = metal */
  arm?: string;
  /** fallback roughness when no arm map */
  rough?: number;
}

async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  const cv = new OffscreenCanvas(size, size);
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return g.getImageData(0, 0, size, size).data;
}

/** extra: raw rgba8 layers appended to the surface array only (e.g. tileable noise) */
export async function loadLayers(assets: AssetLoader, layers: LayerSource[], size: number, extra: Uint8Array[] = []) {
  const n = layers.length;
  const albedo = new Uint8Array(size * size * 4 * n);
  const surface = new Uint8Array(size * size * 4 * (n + extra.length));
  extra.forEach((e, i) => surface.set(e, (n + i) * size * size * 4));
  const px = size * size;
  await Promise.all(layers.map((L, li) => assets.track(`terrain ${L.id}`, (async () => {
    const [d, nm, arm] = await Promise.all([pixels(L.diffuse, size), pixels(L.normal, size), L.arm ? pixels(L.arm, size) : Promise.resolve(null)]);
    const o = li * px * 4;
    albedo.set(d, o);
    for (let p = 0; p < px; p++) {
      const q = p * 4;
      surface[o + q] = nm[q];
      surface[o + q + 1] = nm[q + 1];
      surface[o + q + 2] = arm ? arm[q + 1] : Math.round((L.rough ?? 0.85) * 255);
      surface[o + q + 3] = arm ? arm[q] : 255;
    }
  })(), 2)));
  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new DataArrayTexture(data, size, size, data.length / (size * size * 4));
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: make(albedo, true), surface: make(surface, false), index: Object.fromEntries(layers.map((l, i) => [l.id, i])) as Record<string, number> };
}
