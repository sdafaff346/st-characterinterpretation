import { CHARACTER_VAR_KEY, Profile, Settings } from './schema';

// ---------- settings (script variables, shared across characters) ----------

export const useSettingsStore = defineStore('character_insight_settings', () => {
  const settings = ref(Settings.parse(getVariables({ type: 'script', script_id: getScriptId() })));
  watchEffect(() => {
    insertOrAssignVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
  });
  return { settings };
});

// ---------- profile (character variables, travels with the card) ----------

/** Name of the currently open single character, or null for group chat / no character. */
export function currentCharacterName(): string | null {
  // In Tavern Helper scripts `SillyTavern` is already the getContext() object
  const ctx = SillyTavern;
  if (ctx.groupId || ctx.characterId === undefined || ctx.characterId === null) {
    return null;
  }
  return ctx.characters?.[Number(ctx.characterId)]?.name ?? null;
}

export function loadProfile(): Profile | null {
  if (currentCharacterName() === null) {
    return null;
  }
  try {
    const raw = _.get(getVariables({ type: 'character' }), CHARACTER_VAR_KEY);
    if (raw === undefined) {
      return null;
    }
    return Profile.parse(raw);
  } catch (e) {
    console.warn('[캐릭터해석] failed to load profile', e);
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  const data = Profile.parse({ ...klona(profile), updated_at: new Date().toISOString() });
  // updateVariablesWith replaces the whole key, so removed pairs really disappear
  updateVariablesWith(
    variables => {
      variables[CHARACTER_VAR_KEY] = data;
      return variables;
    },
    { type: 'character' },
  );
}

export function deleteProfile(): void {
  updateVariablesWith(
    variables => {
      delete variables[CHARACTER_VAR_KEY];
      return variables;
    },
    { type: 'character' },
  );
}

// ---------- tiny cross-module signal so UI and injector stay in sync ----------

export const profile_revision = ref(0);
export function bumpProfileRevision() {
  profile_revision.value++;
}
