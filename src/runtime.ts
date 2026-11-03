import { analyzeCurrentCharacter } from './analyze';
import { buildInsightPrompt, buildMvuRulesPrompt, MVU_OUTPUT_FORMAT } from './prompt';
import { defaultMvuState, isProfileEmpty, MVU_KEY, MvuState, Profile, Settings } from './schema';
import { currentCharacterName, loadProfile } from './store';

const INJECT_IDS = {
  insight: 'character_insight',
  rules: 'character_insight_mvu_rules',
  format: 'character_insight_mvu_format',
} as const;

/** UI-facing runtime state */
export const ui = reactive({
  editor_open: false,
  busy: false,
  mvu_ready: false,
  char_name: null as string | null,
  /** draft shown in the editor (analysis result or loaded profile) */
  draft: null as Profile | null,
  /** true when draft came from a fresh analysis and is not saved yet */
  draft_unsaved: false,
});

let getSettings: () => Settings = () => Settings.parse({});
export function bindSettings(getter: () => Settings) {
  getSettings = getter;
}

// ---------------- MVU layer ----------------

function mvuActive(): boolean {
  return ui.mvu_ready && getSettings().mvu_enabled;
}

/** Make a state consistent with the profile: right array length, values in range. */
function normalizeState(raw: unknown, profile: Profile, fallback: MvuState): MvuState {
  const parsed = MvuState.safeParse(raw ?? {});
  const state = parsed.success ? parsed.data : klona(fallback);
  state.기울기 = profile.pairs.map((p, i) => state.기울기[i] ?? fallback.기울기[i] ?? p.lean);
  return state;
}

/** Current dynamic state from the latest message, or defaults. null when MVU is off. */
export function readMvuState(profile: Profile): MvuState | null {
  if (!mvuActive()) {
    return null;
  }
  const fallback = defaultMvuState(profile);
  try {
    const data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    return normalizeState(_.get(data, ['stat_data', MVU_KEY]), profile, fallback);
  } catch {
    return fallback;
  }
}

function registerMvuHooks() {
  // New chat: seed the dynamic layer from the profile
  eventOn(Mvu.events.VARIABLE_INITIALIZED, variables => {
    if (!getSettings().enabled || !getSettings().mvu_enabled) return;
    const profile = loadProfile();
    if (!profile || isProfileEmpty(profile)) return;
    _.set(variables, ['stat_data', MVU_KEY], defaultMvuState(profile));
  });

  // Every update: fill missing values, keep ranges, cap per-reply change
  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (variables, variables_before_update) => {
    const settings = getSettings();
    if (!settings.enabled || !settings.mvu_enabled) return;
    const profile = loadProfile();
    if (!profile || isProfileEmpty(profile)) return;

    const base = defaultMvuState(profile);
    const before = normalizeState(_.get(variables_before_update, ['stat_data', MVU_KEY]), profile, base);
    const after = normalizeState(_.get(variables, ['stat_data', MVU_KEY]), profile, before);
    const d = settings.mvu_max_delta;
    const cap = (next: number, prev: number) => _.clamp(next, Math.max(0, prev - d), Math.min(100, prev + d));

    after.가면균열 = cap(after.가면균열, before.가면균열);
    after.기울기 = after.기울기.map((v, i) => cap(v, before.기울기[i]));
    _.set(variables, ['stat_data', MVU_KEY], after);
  });
}

// ---------------- prompt injection ----------------

export function refreshInjection(): void {
  uninjectPrompts(Object.values(INJECT_IDS));
  ui.char_name = currentCharacterName();

  const settings = getSettings();
  if (!settings.enabled || ui.char_name === null) return;
  const profile = loadProfile();
  if (!profile || isProfileEmpty(profile)) return;

  const state = readMvuState(profile);
  const prompts: InjectionPrompt[] = [
    {
      id: INJECT_IDS.insight,
      position: 'in_chat',
      depth: settings.inject_depth,
      role: settings.inject_role,
      content: buildInsightPrompt(profile, state),
      should_scan: false,
    },
  ];
  if (state && settings.mvu_inject_rules) {
    prompts.push({
      id: INJECT_IDS.rules,
      position: 'in_chat',
      depth: 0,
      role: 'system',
      content: buildMvuRulesPrompt(profile, settings),
      should_scan: false,
    });
    if (settings.mvu_inject_format) {
      prompts.push({
        id: INJECT_IDS.format,
        position: 'in_chat',
        depth: 0,
        role: 'system',
        content: MVU_OUTPUT_FORMAT,
        should_scan: false,
      });
    }
  }
  // Resolve {{char}}/{{user}} ourselves so it works regardless of how ST handles injected text
  injectPrompts(prompts.map(p => ({ ...p, content: substitudeMacros(p.content) })));
}

/** Text the model would receive right now, for the editor preview. */
export function previewPrompt(profile: Profile): string {
  const settings = getSettings();
  const state = readMvuState(profile);
  const parts = [buildInsightPrompt(profile, state)];
  if (state && settings.mvu_inject_rules) parts.push(buildMvuRulesPrompt(profile, settings));
  if (state && settings.mvu_inject_rules && settings.mvu_inject_format) parts.push(MVU_OUTPUT_FORMAT);
  return substitudeMacros(parts.join('\n\n'));
}

// ---------------- user actions ----------------

export function openEditor() {
  ui.char_name = currentCharacterName();
  if (ui.char_name === null) {
    toastr.warning('1:1 채팅에서 캐릭터를 연 상태에서 사용해 주세요. (그룹 채팅은 아직 지원하지 않아요)', '캐릭터 해석');
    return;
  }
  ui.draft = loadProfile() ?? Profile.parse({});
  ui.draft_unsaved = false;
  ui.editor_open = true;
}

export async function runAnalysis() {
  if (ui.busy) return;
  ui.char_name = currentCharacterName();
  if (ui.char_name === null) {
    toastr.warning('1:1 채팅에서 캐릭터를 연 상태에서 사용해 주세요. (그룹 채팅은 아직 지원하지 않아요)', '캐릭터 해석');
    return;
  }
  ui.busy = true;
  const toast = toastr.info(`${ui.char_name} 카드를 분석하는 중…`, '캐릭터 해석', { timeOut: 0, extendedTimeOut: 0 });
  try {
    const result = await analyzeCurrentCharacter(getSettings());
    ui.draft = result;
    ui.draft_unsaved = true;
    ui.editor_open = true;
    toastr.success('분석 완료. 내용을 확인하고 저장해 주세요.', '캐릭터 해석');
  } catch (e) {
    console.error('[캐릭터해석] analysis failed', e);
    toastr.error(String((e as Error).message ?? e), '분석 실패', { timeOut: 10000 });
  } finally {
    toastr.clear(toast);
    ui.busy = false;
  }
}

// ---------------- boot ----------------

export function bootRuntime() {
  refreshInjection();
  eventOn(tavern_events.CHAT_CHANGED, () => refreshInjection());
  // Rebuild right before each generation so the latest MVU values are used
  eventOn(tavern_events.GENERATION_AFTER_COMMANDS, () => refreshInjection());

  // Static mode until (and unless) the MVU script shares its global
  console.info('[캐릭터해석] waiting for MVU; static mode until then');
  waitGlobalInitialized('Mvu').then(() => {
    ui.mvu_ready = true;
    registerMvuHooks();
    console.info('[캐릭터해석] MVU detected; dynamic layer enabled');
    refreshInjection();
  });
}
