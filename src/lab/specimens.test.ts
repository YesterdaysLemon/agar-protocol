import assert from 'node:assert/strict';
import test from 'node:test';

import { toDocument } from '../config/persistence.ts';
import {
  BC,
  IC,
  makeSimulationConfig,
  makeWorldSettings,
} from '../particleSystem/config.ts';
import {
  MAX_ARENA_SPECIMENS,
  SPECIMEN_STORAGE_KEY,
  buildSpecimenArena,
  createSpecimen,
  editSpecimen,
  loadSpecimens,
  ruleFingerprint,
  saveSpecimens,
  type Specimen,
} from './specimens.ts';

function config(ruleOffset = 0) {
  return makeSimulationConfig(
    {
      cohorts: 12,
      mutationSeed: 0.25,
      sensorGain: 1,
      sensorAngle: 0.2,
      sensorDistance: 1.5,
      mutationScale: 0.07,
      globalForceMult: 1,
      drag: 0.1,
      strafePower: 1,
      axialForce: 1,
      lateralForce: 1,
      hazardRate: 0,
    },
    {
      initialConditions: IC.RING,
      cohortFences: true,
      rule: Array.from({ length: 80 }, (_, i) => Math.sin(i + ruleOffset)),
    },
  );
}

const world = makeWorldSettings({
  trailPersistence: 0.91,
  trailDiffusion: 0.22,
  boundaryConditions: BC.DISH,
});

function specimen(name: string, offset = 0): Specimen {
  return createSpecimen(
    {
      projectName: 'Corally',
      generation: 3,
      document: toDocument([config(offset)], world),
    },
    { name, notes: `notes for ${name}` },
    { id: `id-${name}`, capturedAt: '2026-09-01T12:00:00.000Z' },
  );
}

test('a specimen fingerprint follows the exact uploaded f32 bytes', () => {
  const rule = [1 / 3, 0, Math.PI, 1e-30];
  assert.equal(ruleFingerprint(rule), ruleFingerprint(JSON.parse(JSON.stringify(rule)) as number[]));
  // Signed zero is visually the same JavaScript number but a different f32 bit
  // pattern. The fingerprint is deliberately about the bytes, so it notices.
  assert.notEqual(ruleFingerprint(rule), ruleFingerprint([1 / 3, -0, Math.PI, 1e-30]));
});

test('capture canonicalizes one config and editing cannot change its fingerprint', () => {
  const captured = specimen(' Coral baby ');
  assert.equal(captured.name, 'Coral baby');
  assert.equal(captured.generation, 3);
  assert.equal(captured.sourceProject, 'Corally');

  const edited = editSpecimen(captured, { name: 'Branching coral', notes: 'keeper' });
  assert.equal(edited.name, 'Branching coral');
  assert.equal(edited.notes, 'keeper');
  assert.equal(edited.fingerprint, captured.fingerprint);

  const cleared = editSpecimen(edited, { name: edited.name, notes: '' });
  assert.equal(cleared.notes, '');
  assert.equal(cleared.fingerprint, captured.fingerprint);
});

test('the shelf skips an invalid jar instead of discarding valid neighbours', () => {
  const good = specimen('good');
  const values = new Map<string, string>();
  values.set(SPECIMEN_STORAGE_KEY, JSON.stringify([good, { version: 1, id: 'bad' }]));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  assert.deepEqual(loadSpecimens(storage).map((item) => item.name), ['good']);
  saveSpecimens(storage, [good]);
  assert.equal(JSON.parse(values.get(SPECIMEN_STORAGE_KEY) ?? '[]').length, 1);
});

test('a mixed arena preserves parent rules and varies only reproduction/layout fields', () => {
  const parents = [specimen('alpha', 0), specimen('beta', 10)];
  const arena = buildSpecimenArena(parents, 0.125, () => 0.2);

  assert.equal(arena.configs.length, 2);
  assert.deepEqual(arena.world, world);
  for (let i = 0; i < arena.configs.length; i++) {
    const child = arena.configs[i]!;
    const parentRule = config(i === 0 ? 0 : 10).rule;
    assert.deepEqual(child.rule, parentRule);
    assert.equal(child.cohorts, 1);
    assert.equal(child.mutationScale, 0.125);
    assert.equal(child.initialConditions, IC.GRID);
    assert.equal(child.cohortFences, false);
  }
  assert.notEqual(arena.configs[0]!.mutationSeed, arena.configs[1]!.mutationSeed);
});

test('arena construction enforces its population bounds', () => {
  assert.throws(() => buildSpecimenArena([], 0.1), /at least one/i);
  const tooMany = Array.from({ length: MAX_ARENA_SPECIMENS + 1 }, (_, i) => specimen(String(i), i));
  assert.throws(() => buildSpecimenArena(tooMany, 0.1), /at most/i);
});
