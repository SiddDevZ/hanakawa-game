// baked boulder instances: one instanced mesh per piece and lod, re-bucketed by camera distance and
// frustum a few times a second; convex hull colliders for the ones the boat can reach.
import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Quaternion, Sphere, Vector3, Frustum, type Material } from 'three/webgpu';
import type { GameContext } from '../core/context';
import { GROUPS } from '../core/physics';

interface PieceMeta { id: string; dims: number[]; lods: { vOff: number; vCount: number; iOff: number; iCount: number }[] }

export async function createRocks(ctx: GameContext, material: Material) {
  const [meta, bin, placed] = await Promise.all([
    ctx.assets.json<{ pieces: PieceMeta[]; vertexCount: number; indexCount: number }>('/assets/terrain/rocks/rocks.json'),
    ctx.assets.binary('/assets/terrain/rocks/rocks.bin'),
    ctx.assets.json<{ pieces: string[]; stride: number; count: number; instances: number[] }>('/world/rocks.json?v=' + ctx.world.meta.version),
  ]);
  const V = meta.vertexCount;
  const P = new Float32Array(bin, 0, V * 3), Nn = new Float32Array(bin, V * 12, V * 3), I = new Uint32Array(bin, V * 24, meta.indexCount);
  const pieces = placed.pieces.map((id) => meta.pieces.find((p) => p.id === id)!);
  const geos = pieces.map((pc) => pc.lods.map((l) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(P.slice(l.vOff * 3, (l.vOff + l.vCount) * 3), 3));
    g.setAttribute('normal', new BufferAttribute(Nn.slice(l.vOff * 3, (l.vOff + l.vCount) * 3), 3));
    g.setIndex(new BufferAttribute(I.slice(l.iOff, l.iOff + l.iCount), 1));
    g.computeBoundingSphere();
    return g;
  }));

  // instances
  const st = placed.stride, n = placed.count, A = placed.instances;
  const mats: Matrix4[] = [], spheres: Sphere[] = [], pieceOf: number[] = [];
  const q = new Quaternion(), v = new Vector3(), sc = new Vector3();
  const counts = new Array(pieces.length).fill(0);
  for (let k = 0; k < n; k++) {
    const o = k * st;
    const pi = A[o];
    v.set(A[o + 1], A[o + 2], A[o + 3]);
    q.set(A[o + 4], A[o + 5], A[o + 6], A[o + 7]);
    const s = A[o + 8];
    sc.set(s, s, s);
    mats.push(new Matrix4().compose(v, q, sc));
    spheres.push(new Sphere(v.clone(), s * 0.9));
    pieceOf.push(pi);
    counts[pi]++;
  }

  // instanced meshes per piece per lod
  const meshes = pieces.map((_, pi) => geos[pi].map((g, li) => {
    const m = new InstancedMesh(g, material, Math.max(1, counts[pi]));
    m.name = `rocks.${pi}.${li}`;
    m.frustumCulled = false;
    // every lod casts, so a boulder's shadow never vanishes when it drops to its far mesh
    m.castShadow = true;
    m.receiveShadow = true;
    m.count = 0;
    ctx.scene.add(m);
    return m;
  }));

  // colliders: convex hulls from the coarsest lod
  let colliders = 0;
  const R = ctx.physics.RAPIER;
  for (let k = 0; k < n; k++) {
    if (!A[k * st + 9]) continue;
    const l = pieces[pieceOf[k]].lods[2];
    const pts = new Float32Array(l.vCount * 3);
    for (let i = 0; i < l.vCount; i++) {
      v.set(P[(l.vOff + i) * 3], P[(l.vOff + i) * 3 + 1], P[(l.vOff + i) * 3 + 2]).applyMatrix4(mats[k]);
      pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z;
    }
    const d = R.ColliderDesc.convexHull(pts);
    if (!d) continue;
    d.setFriction(0.5).setRestitution(0.1);
    ctx.physics.addStatic(d, GROUPS.STATIC);
    colliders++;
  }

  const frustum = new Frustum(), m4 = new Matrix4(), cam = new Vector3(), last = new Vector3(1e9, 0, 0);
  let lastQuat = new Quaternion(), frame = 0;
  let dist = [55, 170, 520];
  const setDetail = (d: number) => { dist = [55 * d, 170 * d, 520 * Math.max(0.8, d)]; };
  setDetail(ctx.quality.terrainDetail);
  ctx.events.on('quality', (qp: { terrainDetail: number }) => { setDetail(qp.terrainDetail); last.set(1e9, 0, 0); });

  const rebucket = () => {
    for (const row of meshes) for (const m of row) m.count = 0;
    for (let k = 0; k < n; k++) {
      const sp = spheres[k];
      if (!frustum.intersectsSphere(sp)) continue;
      const d = sp.center.distanceTo(cam) - sp.radius;
      // screen size cull: small stones vanish first
      if (d > dist[2] * Math.min(1, sp.radius * 1.2)) continue;
      const li = d < dist[0] ? 0 : d < dist[1] ? 1 : 2;
      const mesh = meshes[pieceOf[k]][li];
      mesh.setMatrixAt(mesh.count++, mats[k]);
    }
    for (const row of meshes) for (const m of row) if (m.count) m.instanceMatrix.needsUpdate = true;
  };
  ctx.onUpdate((c) => {
    frame++;
    c.camera.getWorldPosition(cam);
    const moved = cam.distanceToSquared(last) > 9 || c.camera.quaternion.angleTo(lastQuat) > 0.05;
    if (!moved && frame % 30) return;
    last.copy(cam);
    lastQuat = c.camera.quaternion.clone();
    m4.multiplyMatrices(c.camera.projectionMatrix, c.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m4, c.camera.coordinateSystem);
    rebucket();
  }, 56);

  return { count: n, colliders, meshes };
}
