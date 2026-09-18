import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('src/runtime/characterRuntime.ts', 'utf8');
const clampMatch = source.match(
  /const clampOrbCoordinate = \(value: number, start: number, viewportSize: number, orbSize: number\): number => \{\s*([\s\S]*?)\s*\n\s*\};/,
);
assert.ok(clampMatch, 'the floating-orb coordinate clamp must remain independently testable');
const clampOrbCoordinate = new Function('value', 'start', 'viewportSize', 'orbSize', clampMatch[1]);

// A saved position from a larger desktop viewport must be pulled back inside
// the current viewport, retaining the eight-pixel edge gap where it fits.
assert.equal(clampOrbCoordinate(-420, 0, 900, 50), 8);
assert.equal(clampOrbCoordinate(1_800, 0, 900, 50), 842);
assert.equal(clampOrbCoordinate(450, 0, 900, 50), 450);

// visualViewport offsets are layout-viewport coordinates. A pinch-zoomed or
// shifted mobile viewport must clamp inside that shifted visible rectangle.
assert.equal(clampOrbCoordinate(20, 120, 320, 50), 128);
assert.equal(clampOrbCoordinate(999, 120, 320, 50), 382);

// Never invert the bounds on an exceptionally narrow viewport: align to its
// visible edge so the orb remains reachable instead of being pushed outside.
assert.equal(clampOrbCoordinate(999, 40, 32, 50), 40);

assert.match(source, /const visualViewport = view\?\.visualViewport;/);
assert.match(source, /visualViewport\?\.addEventListener\('resize', clampOrbToViewport\)/);
assert.match(source, /visualViewport\?\.addEventListener\('scroll', clampOrbToViewport\)/);
assert.match(source, /view\?\.addEventListener\('orientationchange', clampOrbToViewport\)/);
assert.match(source, /visualViewport\?\.removeEventListener\('resize', clampOrbToViewport\)/);
assert.match(source, /visualViewport\?\.removeEventListener\('scroll', clampOrbToViewport\)/);
assert.match(source, /orbPosition\?\.x \?\? initialRect\.left/);
assert.match(source, /orb\.setPointerCapture\?\.\(event\.pointerId\)/);
assert.match(source, /orb\.addEventListener\('pointercancel', finishDrag\)/);

console.log('Floating settings orb clamps restored and dragged positions across layout and visual viewport changes.');
