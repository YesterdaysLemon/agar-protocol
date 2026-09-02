/**
 * Browser-local specimen jars and the recipe for turning jars back into an arena.
 *
 * A specimen stores a canonical v8 Fluoddity document. The picture is only a
 * label: breeding always starts from the document's 80-float rule and complete
 * SimulationConfig, so a failed thumbnail capture cannot cost the organism.
 */

import {
  fromDocument,
  toDocument,
  type SavedConfig,
} from '../config/persistence.ts';
import { IC, type SimulationConfig } from '../particleSystem/config.ts';

export const SPECIMEN_STORAGE_KEY = 'fluoddity.specimen-shelf.v1';
export const MAX_SPECIMENS = 24;
export const MAX_ARENA_SPECIMENS = 8;

/** The JSON record persisted in localStorage. */
export interface Specimen {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly notes: string;
  readonly capturedAt: string;
  readonly sourceProject: string;
  readonly generation: number;
  /** FNV-1a over the exact little-endian f32 bytes uploaded for the rule. */
  readonly fingerprint: string;
  /** A canonical Fluoddity v8 document containing exactly one config. */
  readonly document: unknown;
  /** Optional JPEG/WebP data URL. Never used to reconstruct the specimen. */
  readonly thumbnail?: string;
}

export interface SpecimenSource {
  readonly projectName: string;
  readonly generation: number;
  readonly document: unknown;
  readonly thumbnail?: string;
}

export interface SpecimenDetails {
  readonly name: string;
  readonly notes: string;
}

/** Replace only the captured lineage rule, leaving its physical traits intact. */
export function specimenSourceWithRule(
  source: SpecimenSource,
  rule: readonly number[],
): SpecimenSource {
  const saved = fromDocument(source.document, 'selected cohort');
  const config = saved.configs[0];
  if (config === undefined) throw new Error('A selected cohort needs one configuration.');
  if (rule.length !== config.rule.length || rule.some((value) => !Number.isFinite(value))) {
    throw new Error('The selected cohort rule is incomplete.');
  }
  return {
    ...source,
    document: toDocument([{ ...config, rule: [...rule] }], saved.world, saved.notes),
  };
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: string, fallback: string, max: number): string {
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return clean || fallback;
}

function cleanNotes(value: string): string {
  return value.trim().slice(0, 2_000);
}

/**
 * Hash the exact f32 representation used by the ConfigBuffer uploader.
 *
 * JavaScript numbers are f64, while WGSL consumes f32. Hashing DataView's
 * explicit little-endian f32 encoding makes the label describe the bytes that
 * actually reach the organism rather than extra precision the GPU never sees.
 */
export function ruleFingerprint(rule: readonly number[]): string {
  const bytes = new Uint8Array(rule.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < rule.length; i++) {
    view.setFloat32(i * 4, rule[i] ?? 0, true);
  }

  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `F32-${hash.toString(16).padStart(8, '0').toUpperCase()}`;
}

/** Parse and rewrite a document so only supported v8 fields reach the shelf. */
function canonicalDocument(document: unknown, notes?: string): {
  readonly document: unknown;
  readonly saved: SavedConfig;
} {
  const saved = fromDocument(document, 'specimen');
  const config = saved.configs[0];
  if (config === undefined) throw new Error('A specimen needs one configuration.');
  const canonical = toDocument([config], saved.world, notes ?? saved.notes);
  return { document: canonical, saved: fromDocument(canonical, 'specimen') };
}

/** Create one shelf record from the currently selected live config. */
export function createSpecimen(
  source: SpecimenSource,
  details: SpecimenDetails,
  opts: {
    readonly id?: string;
    readonly capturedAt?: string;
  } = {},
): Specimen {
  const name = cleanText(details.name, 'Untitled specimen', 80);
  const notes = cleanNotes(details.notes);
  const canonical = canonicalDocument(source.document, notes);
  const config = canonical.saved.configs[0]!;
  const id = opts.id ?? crypto.randomUUID();
  const capturedAt = opts.capturedAt ?? new Date().toISOString();

  return Object.freeze({
    version: 1 as const,
    id,
    name,
    notes,
    capturedAt,
    sourceProject: cleanText(source.projectName, 'Untitled', 120),
    generation: Math.max(0, Math.floor(source.generation)),
    fingerprint: ruleFingerprint(config.rule),
    document: canonical.document,
    ...(source.thumbnail === undefined ? {} : { thumbnail: source.thumbnail }),
  });
}

/** Rename/re-note a jar without touching any genotype bytes. */
export function editSpecimen(
  specimen: Specimen,
  details: SpecimenDetails,
): Specimen {
  const name = cleanText(details.name, 'Untitled specimen', 80);
  const notes = cleanNotes(details.notes);
  const canonical = canonicalDocument(specimen.document, notes);
  return Object.freeze({
    ...specimen,
    name,
    notes,
    document: canonical.document,
  });
}

/** Validate one untrusted localStorage entry. Invalid jars are skipped. */
function parseSpecimen(value: unknown): Specimen | null {
  const raw = record(value);
  if (raw === null || raw['version'] !== 1) return null;
  if (
    typeof raw['id'] !== 'string' ||
    typeof raw['name'] !== 'string' ||
    typeof raw['notes'] !== 'string' ||
    typeof raw['capturedAt'] !== 'string' ||
    typeof raw['sourceProject'] !== 'string' ||
    typeof raw['generation'] !== 'number' ||
    !Number.isFinite(raw['generation'])
  ) {
    return null;
  }
  if (!Number.isFinite(Date.parse(raw['capturedAt']))) return null;

  try {
    const canonical = canonicalDocument(raw['document'], raw['notes']);
    const config = canonical.saved.configs[0]!;
    const thumbnail = raw['thumbnail'];
    return Object.freeze({
      version: 1,
      id: cleanText(raw['id'], '', 120),
      name: cleanText(raw['name'], 'Untitled specimen', 80),
      notes: cleanNotes(raw['notes']),
      capturedAt: raw['capturedAt'],
      sourceProject: cleanText(raw['sourceProject'], 'Untitled', 120),
      generation: Math.max(0, Math.floor(raw['generation'])),
      // Re-derived rather than trusted: the label can never disagree with the
      // document after a manual localStorage edit or a future migration.
      fingerprint: ruleFingerprint(config.rule),
      document: canonical.document,
      ...(typeof thumbnail === 'string' && /^data:image\//.test(thumbnail)
        ? { thumbnail: thumbnail.slice(0, 500_000) }
        : {}),
    });
  } catch {
    return null;
  }
}

/** Load newest-first jars. Corruption in one jar does not empty the shelf. */
export function loadSpecimens(storage: KeyValueStorage): readonly Specimen[] {
  let parsed: unknown;
  try {
    const raw = storage.getItem(SPECIMEN_STORAGE_KEY);
    if (raw === null) return [];
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(parseSpecimen)
    .filter((item): item is Specimen => item !== null && item.id.length > 0)
    .slice(0, MAX_SPECIMENS);
}

/** Persist newest-first jars, enforcing the shelf capacity at the boundary. */
export function saveSpecimens(
  storage: KeyValueStorage,
  specimens: readonly Specimen[],
): readonly Specimen[] {
  const kept = specimens.slice(0, MAX_SPECIMENS);
  storage.setItem(SPECIMEN_STORAGE_KEY, JSON.stringify(kept));
  return kept;
}

/**
 * Build a multi-config save in which each jar becomes one GPU population.
 *
 * The base rule and every physical trait are copied exactly. Only the four
 * reproduction/layout fields change: one cohort per parent, a caller-chosen
 * mutation scale, a fresh seed, and GRID placement so the lineages begin in
 * separate inoculation spots. A scale of zero is an exact clonal replay.
 */
export function buildSpecimenArena(
  specimens: readonly Specimen[],
  mutationScale: number,
  seed: () => number = Math.random,
): SavedConfig {
  if (specimens.length === 0) throw new Error('Choose at least one specimen.');
  if (specimens.length > MAX_ARENA_SPECIMENS) {
    throw new Error(`An arena can hold at most ${MAX_ARENA_SPECIMENS} specimens.`);
  }
  const variation = Math.max(0, Math.min(0.6, mutationScale));
  let world: SavedConfig['world'] | null = null;
  const configs: SimulationConfig[] = [];

  for (let i = 0; i < specimens.length; i++) {
    const specimen = specimens[i]!;
    const saved = fromDocument(specimen.document, `specimen ${specimen.name}`);
    const parent = saved.configs[0];
    if (parent === undefined) continue;
    world ??= saved.world;
    // The irrational offset keeps even a deterministic or accidentally constant
    // RNG from giving all populations the same mutation draw.
    const mutationSeed = ((seed() % 1) + 1 + i * 0.6180339887498949) % 1;
    configs.push({
      ...parent,
      rule: parent.rule.slice(),
      cohorts: 1,
      mutationScale: variation,
      mutationSeed,
      initialConditions: IC.GRID,
      cohortFences: false,
    });
  }

  if (configs.length === 0 || world === null) {
    throw new Error('None of the selected specimen documents could be read.');
  }
  return {
    configs,
    world,
    notes: `Seeded from: ${specimens.map((item) => item.name).join(', ')}`,
  };
}
