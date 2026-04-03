// Vector math helpers for 2D world-space physics.
//
// Design: plain functions operating on Vec2 objects ({ x, y }).
// No class, no method chaining — keeps hot-loop call sites explicit and
// allocation patterns visible to the caller.
//
// Cross products in 2D: when both inputs are in the XY plane, the cross
// product has only an out-of-plane (z) component. cross2D returns that scalar.
// This is documented at each use site in the physics modules.

import type { Vec2 } from './types';

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function magnitudeSquared(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function magnitude(v: Vec2): number {
  return Math.sqrt(magnitudeSquared(v));
}

export function distance(a: Vec2, b: Vec2): number {
  return magnitude(subtract(a, b));
}

/**
 * Returns the unit vector in the direction of v.
 * If v is the zero vector (magnitude < Number.EPSILON), returns { x: 0, y: 0 }.
 * Callers should guard against zero-magnitude inputs in physics-critical paths.
 */
export function normalize(v: Vec2): Vec2 {
  const mag = magnitude(v);
  if (mag < Number.EPSILON) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
}

/**
 * 2D cross product — returns the scalar z-component of a × b.
 *
 * In 3D: (a.x, a.y, 0) × (b.x, b.y, 0) = (0, 0, a.x*b.y - a.y*b.x).
 * We return only the z-component since a and b are always in the XY plane.
 *
 * Positive z points out of the screen (+Z in right-handed coords).
 */
export function cross2D(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}
