/**
 * Character Insight (캐릭터 해석) — SillyTavern extension
 *
 * Module 1: two-layer reading (surface / core desire / fear / self-deception)
 * Module 2: colliding value pairs (A vs B, lean, behaviour, cost)
 * MVU: when the MVU variable framework is running, tracks a dynamic layer in
 *      stat_data.캐해 (mask crack, per-pair lean, latest dilemma).
 *
 * UI text is Korean; every string the model reads is English.
 */

const MODULE = 'character_insight';
const EXT_FIELD = 'character_insight'; // character card data.extensions key
const MVU_KEY = '캐해'; // key under MVU stat_data
const LOG = '[캐릭터해석]';

const LIMITS = Object.freeze({ layer: 160, side: 24, pair_text: 160, max_pairs: 3, recent: 120 });

const PROMPT_KEYS = Object.freeze({
    insight: `${MODULE}`,
    rules: `${MODULE}_mvu_rules`,
    format: `${MODULE}_mvu_format`,
});

// extension_prompt_types / extension_prompt_roles from script.js (not exported via getContext)
const PROMPT_TYPE = Object.freeze({ NONE: -1, IN_CHAT: 1 });
const PROMPT_ROLE = Object.freeze({ system: 0, user: 1, assistant: 2 });

const defaultSettings = Object.freeze({
    enabled: true,
    inject_depth: 2,
    inject_role: 'system',
    output_language: 'ko',
    analysis_max_tokens: 1500,
    mvu_enabled: true,
    mvu_inject_rules: true,
    mvu_inject_format: false,
    mvu_max_delta: 10,
});

const LAYER_FIELDS = Object.freeze([
    { key: 'surface', label: '보여주는 모습', help: '남들이 보는 행동' },
    { key: 'desire', label: '진짜 욕구', help: '속으로 바라는 것' },
    { key: 'fear', label: '두려움·상처', help: '움직이게 만드는 원인' },
    { key: 'self_deception', label: '스스로 믿는 착각', help: '이야기가 흔들 수 있는 믿음' },
]);

const state = {
    busy: false,
    mvu: null, // window.Mvu once detected
    mvuHooked: false,
};

// ============================================================ settings

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) {
        extensionSettings[MODULE] = structuredClone(defaultSettings);
    }
    const s = extensionSettings[MODULE];
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = defaultSettings[key];
    }
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
    refreshInjection();
}

// ============================================================ normalisers

function cleanText(value, max) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toPercent(value, fallback) {
    const n = Number(value);
    const v = value === null || value === undefined || value === '' || !Number.isFinite(n) ? fallback : n;
    return Math.min(100, Math.max(0, Math.round(v)));
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}

function emptyPair() {
    return { a: '', b: '', lean: 50, behavior: '', cost: '' };
}

/** Repairs any input (AI output, stored data, editor draft) into a valid profile. */
function normalizeProfile(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const layersSrc = src.layers && typeof src.layers === 'object' ? src.layers : {};
    const layers = {};
    for (const { key } of LAYER_FIELDS) layers[key] = cleanText(layersSrc[key], LIMITS.layer);
    const pairs = (Array.isArray(src.pairs) ? src.pairs : [])
        .map(p => ({
            a: cleanText(p?.a, LIMITS.side),
            b: cleanText(p?.b, LIMITS.side),
            lean: toPercent(p?.lean, 50),
            behavior: cleanText(p?.behavior, LIMITS.pair_text),
            cost: cleanText(p?.cost, LIMITS.pair_text),
        }))
        .filter(p => p.a && p.b)
        .slice(0, LIMITS.max_pairs);
    return {
        layers,
        pairs,
        base_crack: toPercent(src.base_crack, 20),
        updated_at: typeof src.updated_at === 'string' ? src.updated_at : '',
    };
}

function isProfileEmpty(profile) {
    return !profile || (LAYER_FIELDS.every(f => !profile.layers[f.key]) && profile.pairs.length === 0);
}

function defaultMvuState(profile) {
    return { 가면균열: profile.base_crack, 기울기: profile.pairs.map(p => p.lean), 최근갈등: '' };
}

/** Make an MVU state consistent with the profile (array length, ranges). */
function normalizeMvuState(raw, profile, fallback) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const leans = Array.isArray(src.기울기) ? src.기울기 : [];
    return {
        가면균열: toPercent(src.가면균열, fallback.가면균열),
        기울기: profile.pairs.map((p, i) => toPercent(leans[i], fallback.기울기[i] ?? p.lean)),
        최근갈등: cleanText(src.최근갈등 ?? fallback.최근갈등, LIMITS.recent),
    };
}

// ============================================================ character storage

/** { id, char } for the open 1:1 character, or null (group chat / none). */
function currentCharacter() {
    const ctx = SillyTavern.getContext();
    if (ctx.groupId || ctx.characterId === undefined || ctx.characterId === null) return null;
    const char = ctx.characters?.[Number(ctx.characterId)];
    return char ? { id: ctx.characterId, char } : null;
}

async function ensureFullCharacter() {
    const cur = currentCharacter();
    if (!cur) return null;
    const { unshallowCharacter } = SillyTavern.getContext();
    if (typeof unshallowCharacter === 'function') {
        try {
            await unshallowCharacter(cur.id);
        } catch (e) {
            console.warn(LOG, 'unshallowCharacter failed', e);
        }
    }
    return currentCharacter();
}

function loadProfile() {
    const cur = currentCharacter();
    const raw = cur?.char?.data?.extensions?.[EXT_FIELD];
    if (!raw) return null;
    const profile = normalizeProfile(raw);
    return isProfileEmpty(profile) ? null : profile;
}

async function saveProfile(profile) {
    const cur = currentCharacter();
    if (!cur) throw new Error('1:1 채팅에서 캐릭터를 연 상태여야 해요.');
    const data = { ...normalizeProfile(profile), updated_at: new Date().toISOString() };
    await SillyTavern.getContext().writeExtensionField(cur.id, EXT_FIELD, data);
}

async function deleteProfile() {
    const cur = currentCharacter();
    if (!cur) return;
    await SillyTavern.getContext().writeExtensionField(cur.id, EXT_FIELD, null);
}

// ============================================================ prompts (English, model-facing)

const LANGUAGE_LINE = {
    ko: 'Write every string value in Korean (한국어). Keep JSON keys in English exactly as specified.',
    en: 'Write every string value in English.',
    card: "Write every string value in the same language as the character card's main text.",
};

function analysisSystemPrompt(settings) {
    return [
        "You are a character analyst for interactive fiction. Read the character card and extract the character's inner logic so another writer can keep them consistent yet multi-faceted in situations the card never mentions.",
        '',
        'Principles:',
        '- Do NOT use personality-type labels (MBTI, enneagram, zodiac, "tsundere", etc.) or bare adjectives ("cold", "kind").',
        '- Write each item as an observable behaviour or a concrete motive, e.g. "Calls out anyone who cuts in line, even strangers" instead of "values fairness".',
        '- Connect motives to causes found in the card when the card gives one. If the card is silent, infer the most plausible cause and keep it modest; do not invent major backstory events.',
        '- Prefer tension: the inner layer should explain or contradict the surface layer, not repeat it.',
        '',
        'Produce two modules:',
        '1. layers — the two-layer reading:',
        '   - surface: how the character presents to others (behaviour, manner).',
        '   - desire: what they actually want underneath.',
        '   - fear: the fear or wound that drives them.',
        '   - self_deception: a false belief they hold about themselves that the story could challenge.',
        "2. pairs — 2 or 3 pairs of the character's own values that collide. For each pair:",
        '   - a, b: short names of the two values (1-4 words each).',
        '   - lean: integer 0-100, how strongly they choose a over b by default (100 = always a, 50 = torn).',
        '   - behavior: what they visibly do when the two collide.',
        '   - cost: what follows when they go against their lean (guilt, rationalisation, a habit, a change in tone...).',
        'Also give base_crack: integer 0-100, how much of the inner layer normally leaks through the surface at the start of a story (0 = perfectly masked, 100 = wears their heart on their sleeve).',
        '',
        `Length limits: each layers field under ${LIMITS.layer} characters; a and b under ${LIMITS.side} characters; behavior and cost under ${LIMITS.pair_text} characters.`,
        LANGUAGE_LINE[settings.output_language] ?? LANGUAGE_LINE.ko,
        '',
        'Output ONLY one JSON object, no commentary, no code fence, in exactly this shape:',
        '{"layers":{"surface":"...","desire":"...","fear":"...","self_deception":"..."},"pairs":[{"a":"...","b":"...","lean":70,"behavior":"...","cost":"..."}],"base_crack":20}',
    ].join('\n');
}

function crackBand(v) {
    if (v <= 20) return 'the surface holds; the inner layer shows only in tiny, deniable slips';
    if (v <= 40) return 'mostly surface; the inner layer leaks through small habits and pauses';
    if (v <= 60) return 'the mask is visibly strained; inner motives surface under pressure';
    if (v <= 80) return 'the inner layer often breaks through; they struggle to keep up appearances';
    return 'the mask has largely fallen; they act from the inner layer and know it';
}

function leanText(a, b, lean) {
    if (lean >= 85) return `firmly toward "${a}"`;
    if (lean >= 60) return `toward "${a}"`;
    if (lean > 40) return 'torn between them';
    if (lean > 15) return `toward "${b}"`;
    return `firmly toward "${b}"`;
}

function buildInsightPrompt(profile, mvuState) {
    const l = profile.layers;
    const out = [
        '<character_insight for="{{char}}">',
        "A structured reading of {{char}}'s inner logic. Use it to keep {{char}} consistent yet multi-faceted, especially in situations the card never covers. Express it through action, choice, tone and subtext; never state these notes outright or have {{char}} recite them.",
    ];
    const layerLines = [
        l.surface && `- Surface (what others see): ${l.surface}`,
        l.desire && `- Core desire (what they actually want): ${l.desire}`,
        l.fear && `- Fear / wound: ${l.fear}`,
        l.self_deception && `- Self-deception (what they wrongly believe about themselves): ${l.self_deception}`,
    ].filter(Boolean);
    if (layerLines.length) {
        out.push('', '[Two layers]', ...layerLines);
        if (mvuState) out.push(`- Mask crack right now: ${mvuState.가면균열}/100 — ${crackBand(mvuState.가면균열)}.`);
    }
    if (profile.pairs.length) {
        out.push('', "[Colliding values] When a scene forces these against each other, {{char}} leans as marked. Going against the lean is possible, but it always leaves the listed cost.");
        profile.pairs.forEach((p, i) => {
            const lean = mvuState?.기울기[i] ?? p.lean;
            out.push(`${i + 1}. "${p.a}" vs "${p.b}" — currently ${leanText(p.a, p.b, lean)} (${lean}/100 toward "${p.a}").`);
            if (p.behavior) out.push(`   When they collide: ${p.behavior}`);
            if (p.cost) out.push(`   Cost of going against the lean: ${p.cost}`);
        });
        if (mvuState?.최근갈등) out.push(`Most recent dilemma: ${mvuState.최근갈등}`);
    }
    out.push(
        '',
        '[How to use]',
        '- Bring in only the parts the current scene actually touches. Do not cycle through every item in each reply.',
        '- Leans are tendencies, not rules: let context, relationships and stakes decide, and let a hard choice show its weight.',
        '- Contradiction between the layers is intended; keep it alive instead of resolving it.',
        '</character_insight>',
    );
    return out.join('\n');
}

function buildMvuRulesPrompt(profile, settings) {
    const d = settings.mvu_max_delta;
    const lines = [
        '<character_insight_variable_rules>',
        `Variables under \`${MVU_KEY}\` track how {{char}}'s inner logic is moving. Update them together with the other variables, using the same update format.`,
        `- ${MVU_KEY}.가면균열 (number 0-100): how much {{char}}'s inner layer shows through the surface right now. Raise it when the scene presses on their fear or wound, when they feel safe enough to drop their guard, or after a choice that cost them. Lower it when they regain composure, feel watched or threatened, or the scene returns to routine. Change by at most ${d} per reply; leave it unchanged when nothing relevant happens.`,
    ];
    if (profile.pairs.length) {
        const legend = profile.pairs.map((p, i) => `index ${i} = "${p.a}" (100) vs "${p.b}" (0)`).join('; ');
        lines.push(
            `- ${MVU_KEY}.기울기 (array of numbers 0-100, ${legend}): shift an entry only when {{char}} actually faces that dilemma on-screen or a story event clearly reshapes those values. Change by at most ${d} per reply. Keep the array length at ${profile.pairs.length}.`,
            `- ${MVU_KEY}.최근갈등 (string, under 25 words): when {{char}} faces one of the dilemmas, record which one, what they chose, and the aftermath. Otherwise keep the old value.`,
        );
    }
    lines.push(
        `JSON Patch paths: /${MVU_KEY}/가면균열, /${MVU_KEY}/기울기/<index>, /${MVU_KEY}/최근갈등.`,
        'The variable-update block is not part of the story and is always required: even when other instructions say to output only the story, finish the story first, then append the variable-update block at the very end of every reply. Never put it inside the thinking or the prose.',
        '</character_insight_variable_rules>',
    );
    return lines.join('\n');
}

// Adapted from StageDog/tavern_helper_template 初始模板/角色卡/世界书/变量/变量输出格式.yaml.
// Only for cards that do not already ship an MVU output-format entry.
const MVU_OUTPUT_FORMAT = `<variable_output_format>
rule:
  - you must output the update analysis and the actual update commands at once in the end of the next reply
  - the update commands works like the **JSON Patch (RFC 6902)** standard, must be a valid JSON array containing operation objects, but supports the following operations instead:
    - replace: replace the value of existing paths
    - delta: update the value of existing number paths by a delta value
    - insert: insert new items into an object or array (using \`-\` as array index intends appending to the end)
    - remove
    - move
  - don't update field names starts with \`_\` as they are readonly
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
</variable_output_format>`;

// ============================================================ MVU integration

function mvuActive() {
    return !!state.mvu && getSettings().mvu_enabled;
}

/** stat_data of the newest message that carries MVU data (MVU stores it per swipe). */
function latestStatData() {
    const { chat } = SillyTavern.getContext();
    for (let i = (chat?.length ?? 0) - 1; i >= 0; i--) {
        const m = chat[i];
        const vars = m?.variables?.[m.swipe_id ?? 0];
        if (vars && typeof vars === 'object' && vars.stat_data) return vars.stat_data;
    }
    return null;
}

function readMvuState(profile) {
    if (!mvuActive()) return null;
    const fallback = defaultMvuState(profile);
    const stat = latestStatData();
    return normalizeMvuState(stat?.[MVU_KEY], profile, fallback);
}

function hookMvu(Mvu) {
    if (state.mvuHooked) return;
    state.mvu = Mvu;
    state.mvuHooked = true;
    const { eventSource } = SillyTavern.getContext();
    const ev = Mvu?.events ?? {};

    // New chat: seed the dynamic layer from the profile
    const onInit = variables => {
        const s = getSettings();
        if (!s.enabled || !s.mvu_enabled) return;
        const profile = loadProfile();
        if (!profile || !variables) return;
        variables.stat_data ??= {};
        variables.stat_data[MVU_KEY] = defaultMvuState(profile);
    };
    const initEvents = new Set([ev.VARIABLE_INITIALIZED, 'mag_variable_initiailized', 'mag_variable_initialized'].filter(Boolean));
    initEvents.forEach(name => eventSource.on(name, onInit));

    // Every update: fill missing values, keep ranges, cap the per-reply change
    eventSource.on(ev.VARIABLE_UPDATE_ENDED ?? 'mag_variable_update_ended', (variables, before) => {
        const s = getSettings();
        if (!s.enabled || !s.mvu_enabled || !variables) return;
        const profile = loadProfile();
        if (!profile) return;
        const base = defaultMvuState(profile);
        const prev = normalizeMvuState(before?.stat_data?.[MVU_KEY], profile, base);
        const next = normalizeMvuState(variables.stat_data?.[MVU_KEY], profile, prev);
        const d = s.mvu_max_delta;
        const cap = (v, p) => clamp(v, Math.max(0, p - d), Math.min(100, p + d));
        next.가면균열 = cap(next.가면균열, prev.가면균열);
        next.기울기 = next.기울기.map((v, i) => cap(v, prev.기울기[i]));
        variables.stat_data ??= {};
        variables.stat_data[MVU_KEY] = next;
    });

    console.info(LOG, 'MVU detected; dynamic layer enabled');
    updateStatus();
    refreshInjection();
}

function watchForMvu() {
    if (window.Mvu) {
        hookMvu(window.Mvu);
        return;
    }
    // Tavern Helper's initializeGlobal() emits this on ST's eventSource
    const { eventSource } = SillyTavern.getContext();
    const handler = () => {
        if (window.Mvu) {
            eventSource.removeListener('global_Mvu_initialized', handler);
            hookMvu(window.Mvu);
        }
    };
    eventSource.on('global_Mvu_initialized', handler);
}

// ============================================================ injection

function clearInjection() {
    const { setExtensionPrompt } = SillyTavern.getContext();
    for (const key of Object.values(PROMPT_KEYS)) setExtensionPrompt(key, '', PROMPT_TYPE.NONE, 0);
}

function refreshInjection() {
    clearInjection();
    updateStatus();
    const s = getSettings();
    if (!s.enabled) return;
    const profile = loadProfile();
    if (!profile) return;

    const { setExtensionPrompt } = SillyTavern.getContext();
    const mvuState = readMvuState(profile);
    const role = PROMPT_ROLE[s.inject_role] ?? PROMPT_ROLE.system;
    setExtensionPrompt(PROMPT_KEYS.insight, buildInsightPrompt(profile, mvuState), PROMPT_TYPE.IN_CHAT, Number(s.inject_depth) || 0, false, role);
    if (mvuState && s.mvu_inject_rules) {
        setExtensionPrompt(PROMPT_KEYS.rules, buildMvuRulesPrompt(profile, s), PROMPT_TYPE.IN_CHAT, 0, false, PROMPT_ROLE.system);
        if (s.mvu_inject_format) {
            setExtensionPrompt(PROMPT_KEYS.format, MVU_OUTPUT_FORMAT, PROMPT_TYPE.IN_CHAT, 0, false, PROMPT_ROLE.system);
        }
    }
}

function previewText(profile) {
    const s = getSettings();
    const mvuState = readMvuState(profile);
    const parts = [buildInsightPrompt(profile, mvuState)];
    if (mvuState && s.mvu_inject_rules) parts.push(buildMvuRulesPrompt(profile, s));
    if (mvuState && s.mvu_inject_rules && s.mvu_inject_format) parts.push(MVU_OUTPUT_FORMAT);
    return SillyTavern.getContext().substituteParams(parts.join('\n\n'));
}

// ============================================================ analysis

function clip(value, max) {
    const s = String(value ?? '').trim();
    return s.length > max ? `${s.slice(0, max)}\n[...truncated]` : s;
}

function extractJson(reply) {
    const cleaned = String(reply ?? '').replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('응답에서 JSON을 찾지 못했어요. (응답 길이 설정을 늘려 보세요)');
    return JSON.parse(cleaned.slice(start, end + 1));
}

async function analyzeCurrentCharacter() {
    const cur = await ensureFullCharacter();
    if (!cur) throw new Error('1:1 채팅에서 캐릭터를 연 상태여야 해요.');
    const { char } = cur;
    const ctx = SillyTavern.getContext();
    const sections = [
        ['Name', char.name],
        ['Description', clip(char.description ?? char.data?.description, 12000)],
        ['Personality', clip(char.personality ?? char.data?.personality, 3000)],
        ['Scenario', clip(char.scenario ?? char.data?.scenario, 3000)],
        ['First message', clip(char.first_mes ?? char.data?.first_mes, 3000)],
        ['Example dialogue', clip(char.mes_example ?? char.data?.mes_example, 4000)],
    ].filter(([, v]) => v);
    const card = ctx.substituteParams(`<character_card>\n${sections.map(([k, v]) => `## ${k}\n${v}`).join('\n\n')}\n</character_card>`);

    const s = getSettings();
    const reply = await ctx.generateRaw({
        systemPrompt: analysisSystemPrompt(s),
        prompt: `${card}\n\nAnalyse this character now. Output the JSON object only.`,
        responseLength: Number(s.analysis_max_tokens) || null,
    });
    console.info(LOG, 'raw analysis reply', reply);
    const profile = normalizeProfile(extractJson(reply));
    if (isProfileEmpty(profile)) throw new Error('분석 결과가 비어 있어요. 다시 시도해 주세요.');
    return profile;
}

async function runAnalysis() {
    if (state.busy) return;
    const cur = currentCharacter();
    if (!cur) {
        toastr.warning('1:1 채팅에서 캐릭터를 연 상태에서 사용해 주세요. (그룹 채팅은 아직 지원하지 않아요)', '캐릭터 해석');
        return;
    }
    state.busy = true;
    updateStatus();
    const toast = toastr.info(`${cur.char.name} 카드를 분석하는 중…`, '캐릭터 해석', { timeOut: 0, extendedTimeOut: 0 });
    let result = null;
    try {
        result = await analyzeCurrentCharacter();
    } catch (e) {
        console.error(LOG, 'analysis failed', e);
        toastr.error(String(e?.message ?? e), '분석 실패', { timeOut: 10000 });
    } finally {
        toastr.clear(toast);
        state.busy = false;
        updateStatus();
    }
    if (result) {
        toastr.success('분석 완료. 내용을 확인하고 저장해 주세요.', '캐릭터 해석');
        await openEditor(result, true);
    }
}

// ============================================================ editor (Popup)

function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function leanLabel(p) {
    const a = p.a || 'A';
    const b = p.b || 'B';
    if (p.lean > 55) return `${a} 쪽 ${p.lean}`;
    if (p.lean < 45) return `${b} 쪽 ${100 - p.lean}`;
    return '팽팽함';
}

function editorHtml(draft, charName, unsaved) {
    const layers = LAYER_FIELDS.map(
        f => `
        <div class="ci-field">
            <label>${esc(f.label)} <small>${esc(f.help)}</small><span class="ci-count" data-count="layer:${f.key}"></span></label>
            <textarea class="text_pole" rows="2" maxlength="${LIMITS.layer}" data-layer="${f.key}">${esc(draft.layers[f.key])}</textarea>
        </div>`,
    ).join('');
    return `
    <div class="ci-editor">
        <h3>캐릭터 해석 · ${esc(charName)} ${unsaved ? '<span class="ci-badge">새 분석 결과 · 저장 전</span>' : ''}</h3>
        <p class="ci-hint">라벨 대신 <b>행동 문장</b>으로 적어 주세요. 예: "공정함" → "남이 새치기하면 참지 않고 지적한다"</p>
        <section>
            <h4>① 겉과 속</h4>
            ${layers}
            <div class="ci-field">
                <label>평소 속마음 노출 정도 <small>MVU 가면균열의 시작값</small><span class="ci-count" data-count="base_crack"></span></label>
                <input type="range" min="0" max="100" step="5" data-base-crack value="${draft.base_crack}" />
                <div class="ci-scale"><span>철저히 감춤</span><span>다 드러남</span></div>
            </div>
        </section>
        <section>
            <h4>② 충돌하는 가치 쌍 <small data-pair-count></small></h4>
            <div data-pairs></div>
            <div class="menu_button ci-add" data-add-pair><i class="fa-solid fa-plus"></i> 가치 쌍 추가</div>
        </section>
        <details class="ci-preview">
            <summary>AI에게 들어가는 프롬프트 미리보기</summary>
            <pre data-preview></pre>
        </details>
    </div>`;
}

function pairHtml(p, i) {
    return `
    <div class="ci-pair" data-pair="${i}">
        <div class="ci-pair-head">
            <input class="text_pole" maxlength="${LIMITS.side}" placeholder="가치 A (예: 정의)" data-pf="a" value="${esc(p.a)}" />
            <span>vs</span>
            <input class="text_pole" maxlength="${LIMITS.side}" placeholder="가치 B (예: 동료)" data-pf="b" value="${esc(p.b)}" />
            <div class="menu_button fa-solid fa-trash-can" title="이 쌍 삭제" data-del-pair></div>
        </div>
        <div class="ci-field">
            <label>기우는 쪽<span class="ci-count" data-lean-label></span></label>
            <input type="range" min="0" max="100" step="5" data-pf="lean" value="${p.lean}" />
            <div class="ci-scale"><span data-side="b">${esc(p.b || 'B')}</span><span>팽팽</span><span data-side="a">${esc(p.a || 'A')}</span></div>
        </div>
        <div class="ci-field">
            <label>부딪힐 때 하는 행동<span class="ci-count" data-count="behavior"></span></label>
            <textarea class="text_pole" rows="2" maxlength="${LIMITS.pair_text}" data-pf="behavior">${esc(p.behavior)}</textarea>
        </div>
        <div class="ci-field">
            <label>반대로 골랐을 때의 대가<span class="ci-count" data-count="cost"></span></label>
            <textarea class="text_pole" rows="2" maxlength="${LIMITS.pair_text}" data-pf="cost">${esc(p.cost)}</textarea>
        </div>
    </div>`;
}

/** Wires the editor DOM to the draft object. */
function bindEditor(root, draft) {
    const q = sel => root.querySelector(sel);

    const updatePreview = () => {
        const pre = q('[data-preview]');
        if (pre) pre.textContent = previewText(normalizeProfile(draft));
    };
    const updateCounts = () => {
        for (const f of LAYER_FIELDS) {
            const el = q(`[data-count="layer:${f.key}"]`);
            if (el) el.textContent = `${draft.layers[f.key].length}/${LIMITS.layer}`;
        }
        q('[data-count="base_crack"]').textContent = String(draft.base_crack);
        q('[data-pair-count]').textContent = `(${draft.pairs.length}/${LIMITS.max_pairs})`;
        q('[data-add-pair]').style.display = draft.pairs.length >= LIMITS.max_pairs ? 'none' : '';
        root.querySelectorAll('[data-pair]').forEach(el => {
            const p = draft.pairs[Number(el.dataset.pair)];
            if (!p) return;
            el.querySelector('[data-lean-label]').textContent = leanLabel(p);
            el.querySelector('[data-count="behavior"]').textContent = `${p.behavior.length}/${LIMITS.pair_text}`;
            el.querySelector('[data-count="cost"]').textContent = `${p.cost.length}/${LIMITS.pair_text}`;
            el.querySelector('[data-side="a"]').textContent = p.a || 'A';
            el.querySelector('[data-side="b"]').textContent = p.b || 'B';
        });
    };
    const renderPairs = () => {
        q('[data-pairs]').innerHTML = draft.pairs.map(pairHtml).join('');
        updateCounts();
        updatePreview();
    };

    root.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.layer) draft.layers[t.dataset.layer] = t.value;
        else if (t.hasAttribute('data-base-crack')) draft.base_crack = Number(t.value);
        else if (t.dataset.pf) {
            const p = draft.pairs[Number(t.closest('[data-pair]').dataset.pair)];
            p[t.dataset.pf] = t.dataset.pf === 'lean' ? Number(t.value) : t.value;
        } else return;
        updateCounts();
    });
    root.addEventListener('change', updatePreview);
    root.addEventListener('click', e => {
        if (e.target.closest('[data-add-pair]')) {
            if (draft.pairs.length < LIMITS.max_pairs) draft.pairs.push(emptyPair());
            renderPairs();
        } else if (e.target.closest('[data-del-pair]')) {
            draft.pairs.splice(Number(e.target.closest('[data-pair]').dataset.pair), 1);
            renderPairs();
        }
    });
    q('details.ci-preview').addEventListener('toggle', updatePreview);
    renderPairs();
}

async function openEditor(initial = null, unsaved = false) {
    const cur = await ensureFullCharacter();
    if (!cur) {
        toastr.warning('1:1 채팅에서 캐릭터를 연 상태에서 사용해 주세요. (그룹 채팅은 아직 지원하지 않아요)', '캐릭터 해석');
        return;
    }
    const { Popup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
    const RESULT_REANALYZE = POPUP_RESULT.CUSTOM1;
    const RESULT_DELETE = POPUP_RESULT.CUSTOM2;

    const base = initial ?? loadProfile() ?? normalizeProfile({});
    // Editable draft: plain copy without the length-filter on pairs (allows half-filled new pairs)
    const draft = { layers: { ...base.layers }, pairs: base.pairs.map(p => ({ ...p })), base_crack: base.base_crack };
    let dirty = unsaved;

    const popup = new Popup(editorHtml(draft, cur.char.name, unsaved), POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        leftAlign: true,
        okButton: '저장',
        cancelButton: '닫기',
        customButtons: [
            { text: '다시 분석', icon: 'fa-wand-magic-sparkles', result: RESULT_REANALYZE },
            { text: '삭제', icon: 'fa-trash-can', result: RESULT_DELETE },
        ],
        onOpen: p => {
            bindEditor(p.content, draft);
            p.content.addEventListener('input', () => (dirty = true));
        },
        onClosing: async p => {
            if (p.result === POPUP_RESULT.AFFIRMATIVE) {
                const incomplete = draft.pairs.some(x => (x.a || x.b) && !(x.a && x.b));
                if (incomplete) {
                    toastr.warning('A와 B를 둘 다 적지 않은 가치 쌍은 저장되지 않아요.', '캐릭터 해석');
                }
                return true;
            }
            if (p.result === RESULT_DELETE) {
                const ok = await Popup.show.confirm('캐릭터 해석 삭제', `${esc(cur.char.name)}의 캐릭터 해석을 삭제할까요?`);
                return ok === POPUP_RESULT.AFFIRMATIVE;
            }
            if (dirty && p.result !== RESULT_REANALYZE) {
                const ok = await Popup.show.confirm('저장하지 않고 닫기', '저장하지 않은 내용이 있어요. 닫을까요?');
                return ok === POPUP_RESULT.AFFIRMATIVE;
            }
            return true;
        },
    });

    const result = await popup.show();
    if (result === POPUP_RESULT.AFFIRMATIVE) {
        try {
            await saveProfile(draft);
            refreshInjection();
            toastr.success('저장했어요. 다음 답변부터 적용돼요.', '캐릭터 해석');
        } catch (e) {
            console.error(LOG, 'save failed', e);
            toastr.error(String(e?.message ?? e), '저장 실패');
        }
    } else if (result === RESULT_DELETE) {
        await deleteProfile();
        refreshInjection();
        toastr.info('삭제했어요.', '캐릭터 해석');
    } else if (result === RESULT_REANALYZE) {
        await runAnalysis();
    }
}

// ============================================================ settings panel & menu

function updateStatus() {
    const cur = currentCharacter();
    const profile = cur ? loadProfile() : null;
    $('#ci_status_char').text(cur ? cur.char.name : '없음 (1:1 채팅에서 사용)');
    $('#ci_status_profile').text(!cur ? '-' : profile ? '저장됨' : '없음 (카드 분석을 눌러 주세요)');
    $('#ci_status_mvu')
        .text(state.mvu ? '감지됨' : '없음 (고정 모드)')
        .toggleClass('ci-ok', !!state.mvu);
    $('#ci_analyze').prop('disabled', state.busy).val(state.busy ? '분석 중…' : '카드 분석');
}

function settingsHtml() {
    return `
    <div id="ci_settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>캐릭터 해석 (겉과 속 · 충돌 가치)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="ci-status">
                    <span>캐릭터: <b id="ci_status_char"></b></span>
                    <span>해석: <b id="ci_status_profile"></b></span>
                    <span>MVU: <b id="ci_status_mvu"></b></span>
                </div>
                <div class="flex-container">
                    <input id="ci_analyze" class="menu_button" type="button" value="카드 분석" />
                    <input id="ci_edit" class="menu_button" type="button" value="편집 열기" />
                </div>
                <hr class="sysHR" />
                <label class="checkbox_label"><input id="ci_enabled" type="checkbox" /> 답변 생성 때 주입하기</label>
                <div class="ci-row"><label for="ci_depth">주입 깊이 (0 = 맨 끝)</label><input id="ci_depth" class="text_pole" type="number" min="0" max="20" /></div>
                <div class="ci-row"><label for="ci_role">주입 역할</label>
                    <select id="ci_role" class="text_pole"><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></div>
                <div class="ci-row"><label for="ci_lang">분석 결과 언어</label>
                    <select id="ci_lang" class="text_pole"><option value="ko">한국어</option><option value="en">영어</option><option value="card">카드와 같은 언어</option></select></div>
                <div class="ci-row"><label for="ci_tokens">분석 응답 길이 (토큰)</label><input id="ci_tokens" class="text_pole" type="number" min="300" max="8000" step="100" /></div>
                <hr class="sysHR" />
                <b>MVU 연동</b>
                <label class="checkbox_label"><input id="ci_mvu" type="checkbox" /> 가면 균열·가치 기울기를 MVU 변수로 추적</label>
                <label class="checkbox_label"><input id="ci_mvu_rules" type="checkbox" /> 변수 갱신 규칙 주입</label>
                <label class="checkbox_label" title="카드에 이미 [mvu_update] 변수 출력 형식 항목이 있으면 끄세요"><input id="ci_mvu_format" type="checkbox" /> 변수 출력 형식도 주입 (MVU 카드가 아닐 때만)</label>
                <div class="ci-row"><label for="ci_delta">한 턴 최대 변화량</label><input id="ci_delta" class="text_pole" type="number" min="1" max="50" /></div>
                <small class="ci-note">슬래시 커맨드: <code>/caehae analyze</code> · <code>/caehae edit</code> · <code>/caehae show</code></small>
            </div>
        </div>
    </div>`;
}

function bindSettingsUI() {
    const s = getSettings();
    const bindCheck = (id, key) => $(id).prop('checked', !!s[key]).on('change', function () {
        s[key] = $(this).prop('checked');
        saveSettings();
    });
    const bindNumber = (id, key, lo, hi) => $(id).val(s[key]).on('change', function () {
        const n = Number($(this).val());
        s[key] = Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : defaultSettings[key];
        $(this).val(s[key]);
        saveSettings();
    });
    const bindSelect = (id, key) => $(id).val(s[key]).on('change', function () {
        s[key] = String($(this).val());
        saveSettings();
    });

    bindCheck('#ci_enabled', 'enabled');
    bindNumber('#ci_depth', 'inject_depth', 0, 20);
    bindSelect('#ci_role', 'inject_role');
    bindSelect('#ci_lang', 'output_language');
    bindNumber('#ci_tokens', 'analysis_max_tokens', 300, 8000);
    bindCheck('#ci_mvu', 'mvu_enabled');
    bindCheck('#ci_mvu_rules', 'mvu_inject_rules');
    bindCheck('#ci_mvu_format', 'mvu_inject_format');
    bindNumber('#ci_delta', 'mvu_max_delta', 1, 50);
    $('#ci_analyze').on('click', () => runAnalysis());
    $('#ci_edit').on('click', () => openEditor());
}

function addMenuButtons() {
    const $menu = $('#extensionsMenu');
    if (!$menu.length) return;
    const item = (id, icon, label, fn) =>
        $(`<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
              <div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span></div>`).on('click', fn);
    $menu.append(item('ci_menu_analyze', 'fa-masks-theater', '캐해 분석', () => runAnalysis()));
    $menu.append(item('ci_menu_edit', 'fa-pen-to-square', '캐해 편집', () => openEditor()));
}

function registerCaehaeCommand() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = SillyTavern.getContext();
    if (!SlashCommandParser?.addCommandObject) return;
    SlashCommandParser.addCommandObject(
        SlashCommand.fromProps({
            name: 'caehae',
            aliases: ['charinsight'],
            returns: 'the injected insight text for "show", otherwise empty',
            callback: async (_named, unnamed) => {
                const action = String(unnamed ?? '').trim() || 'edit';
                if (action === 'analyze') await runAnalysis();
                else if (action === 'edit') await openEditor();
                else if (action === 'show') {
                    const profile = loadProfile();
                    return profile ? previewText(profile) : '';
                } else toastr.warning('사용법: /caehae analyze | edit | show', '캐릭터 해석');
                return '';
            },
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'analyze | edit | show',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: false,
                    enumList: ['analyze', 'edit', 'show'],
                }),
            ],
            helpString: '<div>캐릭터 해석 확장. <code>/caehae analyze</code> 카드 분석, <code>/caehae edit</code> 편집 창, <code>/caehae show</code> 주입 텍스트 반환.</div>',
        }),
    );
}

// ============================================================ boot

function init() {
    getSettings();
    $('#extensions_settings2').append(settingsHtml());
    bindSettingsUI();
    addMenuButtons();
    registerCaehaeCommand();

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        await ensureFullCharacter();
        refreshInjection();
    });
    // Rebuild right before each generation so the latest MVU values are used
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => refreshInjection());
    eventSource.on(event_types.CHARACTER_EDITED, () => refreshInjection());

    watchForMvu();
    refreshInjection();
    console.info(LOG, 'loaded');
}

(function boot() {
    const { eventSource, event_types } = SillyTavern.getContext();
    // APP_READY fires immediately for late listeners
    eventSource.on(event_types.APP_READY, () => {
        try {
            init();
        } catch (e) {
            console.error(LOG, 'init failed', e);
            toastr.error(String(e?.message ?? e), '캐릭터 해석 로드 실패');
        }
    });
})();
