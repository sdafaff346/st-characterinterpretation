import { LIMITS, Profile, Settings } from './schema';

// Model-facing text is English by design; only the *content* language is configurable.

const LANGUAGE_LINE: Record<Settings['output_language'], string> = {
  ko: 'Write every string value in Korean (한국어). Keep JSON keys in English exactly as specified.',
  en: 'Write every string value in English.',
  card: "Write every string value in the same language as the character card's main text.",
};

function buildSystemPrompt(settings: Settings): string {
  return dedent(`
    You are a character analyst for interactive fiction. Read the character card and extract the character's inner logic so another writer can keep them consistent yet multi-faceted in situations the card never mentions.

    Principles:
    - Do NOT use personality-type labels (MBTI, enneagram, zodiac, "tsundere", etc.) or bare adjectives ("cold", "kind").
    - Write each item as an observable behaviour or a concrete motive, e.g. "Calls out anyone who cuts in line, even strangers" instead of "values fairness".
    - Connect motives to causes found in the card when the card gives one. If the card is silent, infer the most plausible cause and keep it modest; do not invent major backstory events.
    - Prefer tension: the inner layer should explain or contradict the surface layer, not repeat it.

    Produce two modules:
    1. layers — the two-layer reading:
       - surface: how the character presents to others (behaviour, manner).
       - desire: what they actually want underneath.
       - fear: the fear or wound that drives them.
       - self_deception: a false belief they hold about themselves that the story could challenge.
    2. pairs — 2 or 3 pairs of the character's own values that collide. For each pair:
       - a, b: short names of the two values (1-4 words each).
       - lean: integer 0-100, how strongly they choose a over b by default (100 = always a, 50 = torn).
       - behavior: what they visibly do when the two collide.
       - cost: what follows when they go against their lean (guilt, rationalisation, a habit, a change in tone...).
    Also give base_crack: integer 0-100, how much of the inner layer normally leaks through the surface at the start of a story (0 = perfectly masked, 100 = wears their heart on their sleeve).

    Length limits: each layers field under ${LIMITS.layer} characters; a and b under ${LIMITS.pair_side} characters; behavior and cost under ${LIMITS.pair_text} characters.
    ${LANGUAGE_LINE[settings.output_language]}

    Output ONLY one JSON object, no commentary, no code fence, in exactly this shape:
    {"layers":{"surface":"...","desire":"...","fear":"...","self_deception":"..."},"pairs":[{"a":"...","b":"...","lean":70,"behavior":"...","cost":"..."}],"base_crack":20}
  `);
}

function clip(value: string | undefined, max: number): string {
  const s = (value ?? '').trim();
  return s.length > max ? s.slice(0, max) + '\n[...truncated]' : s;
}

function buildCardText(): string {
  const char = getCharData('current');
  if (!char) {
    throw new Error('현재 열린 캐릭터 카드를 찾지 못했어요.');
  }
  const sections: [string, string][] = [
    ['Name', char.name],
    ['Description', clip(char.description, 12000)],
    ['Personality', clip(char.personality, 3000)],
    ['Scenario', clip(char.scenario, 3000)],
    ['First message', clip(char.first_mes, 3000)],
    ['Example dialogue', clip(char.mes_example, 4000)],
  ];
  const body = sections
    .filter(([, v]) => v)
    .map(([k, v]) => `## ${k}\n${v}`)
    .join('\n\n');
  // Resolve {{char}} / {{user}} so the analyst sees real names
  return substitudeMacros(`<character_card>\n${body}\n</character_card>`);
}

/** Pull the first JSON object out of a model reply (tolerates code fences and stray text). */
export function extractJson(reply: string): unknown {
  const cleaned = reply.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('응답에서 JSON을 찾지 못했어요.');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function analyzeCurrentCharacter(settings: Settings): Promise<Profile> {
  const card_text = buildCardText();
  const reply = await generateRaw({
    should_silence: true,
    max_chat_history: 0,
    ordered_prompts: [
      { role: 'system', content: buildSystemPrompt(settings) },
      { role: 'user', content: `${card_text}\n\nAnalyse this character now. Output the JSON object only.` },
    ],
  });
  console.info('[캐릭터해석] raw analysis reply', reply);
  const parsed = Profile.safeParse(extractJson(reply));
  if (!parsed.success) {
    throw new Error(z.prettifyError(parsed.error));
  }
  return parsed.data;
}
