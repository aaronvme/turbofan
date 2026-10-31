// W2A-I9 (critic pass 17): a warm frame must leave the next real frame's motion vectors intact.
// post.ts's motion vectors reproject with the previous frame's view-projection (src/render/
// viewProjRoll.ts). A warm frame (D4-91) is drawn before the tick's real frame and rolls the
// matrices for its own draw; if it leaves this frame's view-projection behind as "current", the
// real frame after it copies that into "previous", and TRAA reprojects as if the camera had not
// moved. It shows while the viewer orbits under "Preparing": a cold switch's own view warms then.
import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three/webgpu';
import { createViewProjRoll } from '../../../src/render/viewProjRoll';
import { orbitPose, type OrbitState } from '../../../src/shell/orbit';

/** The camera at an orbit (the app's own pose), and its unjittered view-projection. */
function viewProjAt(s: OrbitState): Matrix4 {
  const cam = new PerspectiveCamera(35, 1366 / 768, 0.05, 200);
  const pose = orbitPose(s);
  cam.position.set(...pose.position);
  cam.lookAt(new Vector3(...pose.target));
  cam.updateMatrixWorld();
  return new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

/** A world point's camera motion in NDC, as post.ts's cameraLoad computes it (current - previous). */
function motion(roll: { prev: Matrix4; curr: Matrix4 }, p: Vector3): [number, number] {
  const c = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(roll.curr);
  const q = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(roll.prev);
  return [c.x / c.w - q.x / q.w, c.y / c.w - q.y / q.w];
}

const orbitAt = (k: number): OrbitState => ({
  azimuth: 0.6 + 0.02 * k,
  elevation: 0.25,
  distance: 9,
  target: [0.4, 0, 0],
});

describe('W2A-I9: a warm frame leaves the next real frame camera motion intact', () => {
  const point = new Vector3(1.2, 0.5, 0.3);

  it('an orbiting camera with a warm frame before each real frame (a cold switch preparing)', () => {
    const plain = createViewProjRoll(new Matrix4(), new Matrix4(), new Matrix4());
    const warmed = createViewProjRoll(new Matrix4(), new Matrix4(), new Matrix4());
    for (let k = 0; k < 6; k++) {
      const vp = viewProjAt(orbitAt(k));
      // the tick: the warm frame (the same camera as the tick's real frame), then the real frame
      const restore = warmed.save();
      warmed.roll(vp);
      restore();
      warmed.roll(vp);
      plain.roll(vp);
      // the real frame's matrices are the ones without a warm frame
      expect(warmed.prev.elements).toEqual(plain.prev.elements);
      expect(warmed.curr.elements).toEqual(plain.curr.elements);
      expect(warmed.currInv.elements).toEqual(plain.currInv.elements);
      if (k === 0) continue;
      // and the camera moved: the point's motion is the orbit's, not zero
      const [mx, my] = motion(warmed, point);
      expect(Math.hypot(mx, my)).toBeGreaterThan(1e-3);
      expect(warmed.prev.elements).toEqual(viewProjAt(orbitAt(k - 1)).elements);
    }
  });

  it('a warm frame draws with its own frame rolled in (its motion is its camera against the last real frame)', () => {
    const roll = createViewProjRoll(new Matrix4(), new Matrix4(), new Matrix4());
    roll.roll(viewProjAt(orbitAt(0)));
    const restore = roll.save();
    roll.roll(viewProjAt(orbitAt(1)));
    expect(roll.prev.elements).toEqual(viewProjAt(orbitAt(0)).elements);
    expect(roll.curr.elements).toEqual(viewProjAt(orbitAt(1)).elements);
    restore();
    expect(roll.curr.elements).toEqual(viewProjAt(orbitAt(0)).elements);
  });

  it('the first frame has no motion (previous = current)', () => {
    const roll = createViewProjRoll(new Matrix4(), new Matrix4(), new Matrix4());
    roll.roll(viewProjAt(orbitAt(3)));
    expect(roll.prev.elements).toEqual(roll.curr.elements);
    const [mx, my] = motion(roll, point);
    expect(Math.hypot(mx, my)).toBe(0);
  });
});
