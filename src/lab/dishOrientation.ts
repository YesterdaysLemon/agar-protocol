import type { CameraState } from '../camera/cameraState.ts';

/** One shared notification keeps the rim handle and the drawer readout in sync. */
export const DISH_ROTATION_EVENT = 'fluoddity:dish-rotation';

/** Compact an angular difference so crossing -pi/pi does not flip the dish. */
export function compactAngleDelta(from: number, to: number): number {
  const turn = Math.PI * 2;
  return ((to - from + Math.PI) % turn + turn) % turn - Math.PI;
}

/**
 * A bearing drawn on the dish rotates opposite the camera transform. Dragging
 * that bearing clockwise therefore rotates the camera counter-clockwise.
 */
export function rotationFromBearingDrag(
  startRotation: number,
  startPointerAngle: number,
  pointerAngle: number,
): number {
  return startRotation - compactAngleDelta(startPointerAngle, pointerAngle);
}

export function announceDishRotation(): void {
  window.dispatchEvent(new Event(DISH_ROTATION_EVENT));
}

export function setDishRotation(camera: CameraState, radians: number): void {
  camera.setRotationAroundWorldOrigin(radians);
  announceDishRotation();
}

export function rotateDishBy(camera: CameraState, radians: number): void {
  camera.rotateAroundWorldOriginBy(radians);
  announceDishRotation();
}
