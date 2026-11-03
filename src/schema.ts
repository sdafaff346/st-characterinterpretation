// Data shapes for the Character Insight script (modules 1 & 2).
// Text fields are trimmed and truncated instead of rejected so AI output is repaired, not discarded.

export const LIMITS = {
  layer: 160, // each two-layer field
  pair_side: 24, // value name A / B
  pair_text: 160, // behaviour / cost sentences
  max_pairs: 3,
  recent: 120,
} as const;

const text = (max: number) =>
  z
    .any()
    .optional()
    .transform(v => (v === null || v === undefined ? '' : String(v)))
    .transform(v => v.replace(/\s+/g, ' ').trim().slice(0, max));

const percent = (fallback: number) =>
  z
    .any()
    .optional()
    .transform(v => {
      const n = Number(v);
      return _.clamp(Math.round(v === null || v === undefined || v === '' || !Number.isFinite(n) ? fallback : n), 0, 100);
    });

/** Module 1: surface vs inner layer */
export const Layers = z
  .object({
    surface: text(LIMITS.layer).describe('What others see: observable behaviour'),
    desire: text(LIMITS.layer).describe('What the character truly wants'),
    fear: text(LIMITS.layer).describe('Fear or old wound that drives them'),
    self_deception: text(LIMITS.layer).describe('A false belief they hold about themselves'),
  })
  .prefault({});
export type Layers = z.output<typeof Layers>;

/** Module 2: one pair of colliding values */
export const ValuePair = z
  .object({
    a: text(LIMITS.pair_side),
    b: text(LIMITS.pair_side),
    /** 0-100, how strongly the character leans to A by default (100 = always A) */
    lean: percent(50),
    /** what the character typically does when the collision happens */
    behavior: text(LIMITS.pair_text),
    /** what follows if they go against their lean */
    cost: text(LIMITS.pair_text),
  })
  .prefault({});
export type ValuePair = z.output<typeof ValuePair>;

export const Profile = z
  .object({
    layers: Layers,
    pairs: z
      .array(ValuePair)
      .default([])
      .catch([])
      .transform(pairs => pairs.filter(p => p.a && p.b).slice(0, LIMITS.max_pairs)),
    /** starting value for the MVU mask-crack variable */
    base_crack: percent(20),
    updated_at: z.string().default('').catch(''),
  })
  .prefault({});
export type Profile = z.output<typeof Profile>;

export function isProfileEmpty(profile: Profile): boolean {
  const l = profile.layers;
  return !l.surface && !l.desire && !l.fear && !l.self_deception && profile.pairs.length === 0;
}

/** Key in character variables that holds the base profile */
export const CHARACTER_VAR_KEY = '캐릭터해석';

/** Key under MVU stat_data that holds the dynamic layer */
export const MVU_KEY = '캐해';

/** Dynamic layer stored in MVU stat_data (per message, branches with swipes) */
export const MvuState = z
  .object({
    가면균열: percent(20),
    기울기: z.array(percent(50)).default([]).catch([]),
    최근갈등: text(LIMITS.recent).catch(''),
  })
  .prefault({});
export type MvuState = z.output<typeof MvuState>;

export function defaultMvuState(profile: Profile): MvuState {
  return {
    가면균열: profile.base_crack,
    기울기: profile.pairs.map(p => p.lean),
    최근갈등: '',
  };
}

/** Script settings (stored in script variables) */
export const Settings = z
  .object({
    enabled: z.boolean().default(true),
    inject_depth: z.coerce.number().int().min(0).max(20).default(2).catch(2),
    inject_role: z.enum(['system', 'user', 'assistant']).default('system').catch('system'),
    output_language: z.enum(['ko', 'en', 'card']).default('ko').catch('ko'),
    mvu_enabled: z.boolean().default(true),
    mvu_inject_rules: z.boolean().default(true),
    mvu_inject_format: z.boolean().default(false),
    mvu_max_delta: z.coerce.number().int().min(1).max(50).default(10).catch(10),
  })
  .prefault({});
export type Settings = z.output<typeof Settings>;
