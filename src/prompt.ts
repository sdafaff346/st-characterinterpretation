import { MVU_KEY, MvuState, Profile, Settings } from './schema';

// Everything in this file is read by the roleplay model, so it is written in English.

function crackBand(value: number): string {
  if (value <= 20) return 'the surface holds; the inner layer shows only in tiny, deniable slips';
  if (value <= 40) return 'mostly surface; the inner layer leaks through small habits and pauses';
  if (value <= 60) return 'the mask is visibly strained; inner motives surface under pressure';
  if (value <= 80) return 'the inner layer often breaks through; they struggle to keep up appearances';
  return 'the mask has largely fallen; they act from the inner layer and know it';
}

function leanText(a: string, b: string, lean: number): string {
  if (lean >= 85) return `firmly toward "${a}"`;
  if (lean >= 60) return `toward "${a}"`;
  if (lean > 40) return `torn between them`;
  if (lean > 15) return `toward "${b}"`;
  return `firmly toward "${b}"`;
}

export function buildInsightPrompt(profile: Profile, state: MvuState | null): string {
  const l = profile.layers;
  const lines: string[] = [];
  lines.push('<character_insight for="{{char}}">');
  lines.push(
    "A structured reading of {{char}}'s inner logic. Use it to keep {{char}} consistent yet multi-faceted, especially in situations the card never covers. Express it through action, choice, tone and subtext; never state these notes outright or have {{char}} recite them.",
  );

  const layer_lines = [
    l.surface && `- Surface (what others see): ${l.surface}`,
    l.desire && `- Core desire (what they actually want): ${l.desire}`,
    l.fear && `- Fear / wound: ${l.fear}`,
    l.self_deception && `- Self-deception (what they wrongly believe about themselves): ${l.self_deception}`,
  ].filter(Boolean) as string[];
  if (layer_lines.length) {
    lines.push('', '[Two layers]', ...layer_lines);
    if (state) {
      lines.push(`- Mask crack right now: ${state.가면균열}/100 — ${crackBand(state.가면균열)}.`);
    }
  }

  if (profile.pairs.length) {
    lines.push(
      '',
      '[Colliding values] When a scene forces these against each other, {{char}} leans as marked. Going against the lean is possible, but it always leaves the listed cost.',
    );
    profile.pairs.forEach((p, i) => {
      const lean = state?.기울기[i] ?? p.lean;
      lines.push(`${i + 1}. "${p.a}" vs "${p.b}" — currently ${leanText(p.a, p.b, lean)} (${lean}/100 toward "${p.a}").`);
      if (p.behavior) lines.push(`   When they collide: ${p.behavior}`);
      if (p.cost) lines.push(`   Cost of going against the lean: ${p.cost}`);
    });
    if (state?.최근갈등) {
      lines.push(`Most recent dilemma: ${state.최근갈등}`);
    }
  }

  lines.push(
    '',
    '[How to use]',
    '- Bring in only the parts the current scene actually touches. Do not cycle through every item in each reply.',
    '- Leans are tendencies, not rules: let context, relationships and stakes decide, and let a hard choice show its weight.',
    '- Contradiction between the layers is intended; keep it alive instead of resolving it.',
  );
  lines.push('</character_insight>');
  return lines.join('\n');
}

export function buildMvuRulesPrompt(profile: Profile, settings: Settings): string {
  const d = settings.mvu_max_delta;
  const pairs = profile.pairs.map((p, i) => `index ${i} = "${p.a}" (100) vs "${p.b}" (0)`).join('; ');
  return dedent(`
    <character_insight_variable_rules>
    Variables under \`${MVU_KEY}\` track how {{char}}'s inner logic is moving. Update them together with the other variables, using the same update format.
    - ${MVU_KEY}.가면균열 (number 0-100): how much {{char}}'s inner layer shows through the surface right now. Raise it when the scene presses on their fear or wound, when they feel safe enough to drop their guard, or after a choice that cost them. Lower it when they regain composure, feel watched or threatened, or the scene returns to routine. Change by at most ${d} per reply; leave it unchanged when nothing relevant happens.
    ${
      profile.pairs.length
        ? `- ${MVU_KEY}.기울기 (array of numbers 0-100, ${pairs}): shift an entry only when {{char}} actually faces that dilemma on-screen or a story event clearly reshapes those values. Change by at most ${d} per reply. Keep the array length at ${profile.pairs.length}.
    - ${MVU_KEY}.최근갈등 (string, under 25 words): when {{char}} faces one of the dilemmas, record which one, what they chose, and the aftermath. Otherwise keep the old value.`
        : ''
    }
    JSON Patch paths: /${MVU_KEY}/가면균열, /${MVU_KEY}/기울기/<index>, /${MVU_KEY}/최근갈등.
    </character_insight_variable_rules>
  `);
}

// Copied from StageDog/tavern_helper_template 初始模板/角色卡/世界书/变量/变量输出格式.yaml,
// only for cards that do not already ship an MVU output-format entry.
export const MVU_OUTPUT_FORMAT = dedent(`
  <variable_output_format>
  rule:
    - you must output the update analysis and the actual update commands at once in the end of the next reply
    - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:
      - replace: replace the value of existing paths
      - delta: update the value of existing number paths by a delta value
      - insert: insert new items into an object or array (using \`-\` as array index intends appending to the end)
      - remove
      - move
    - don't update field names starts with \`_\` as they are readonly, such as \`_变量\`
  format: |-
    <UpdateVariable>
    <Analysis>$(IN ENGLISH, no more than 80 words)
    - \${analyze every variable based on its rule, according only to current reply instead of previous plots: ...}
    </Analysis>
    <JSONPatch>
    [
      { "op": "replace", "path": "\${/path/to/variable}", "value": "\${new_value}" },
      { "op": "delta", "path": "\${/path/to/number/variable}", "value": "\${positive_or_negative_delta}" },
      ...
    ]
    </JSONPatch>
    </UpdateVariable>
  </variable_output_format>
`);
