<template>
  <div v-if="ui.editor_open && ui.draft" class="ci-overlay" @click.self="close">
    <div class="ci-modal" role="dialog" aria-label="캐릭터 해석 편집">
      <header class="ci-head">
        <div>
          <b>캐릭터 해석 · {{ ui.char_name }}</b>
          <span v-if="ui.draft_unsaved" class="ci-badge">새 분석 결과 · 저장 전</span>
        </div>
        <button class="ci-x" type="button" title="닫기" @click="close">✕</button>
      </header>

      <div class="ci-body">
        <p class="ci-hint">
          라벨 대신 <b>행동 문장</b>으로 적어 주세요. 예: "공정함" → "남이 새치기하면 참지 않고 지적한다"
        </p>

        <section>
          <h4>① 겉과 속</h4>
          <div v-for="f in layer_fields" :key="f.key" class="ci-field">
            <label>
              {{ f.label }} <small>{{ f.help }}</small>
              <span class="ci-count">{{ ui.draft.layers[f.key].length }}/{{ LIMITS.layer }}</span>
            </label>
            <textarea v-model="ui.draft.layers[f.key]" class="text_pole" rows="2" :maxlength="LIMITS.layer" />
          </div>
          <div class="ci-field">
            <label>평소 속마음 노출 정도 <small>MVU 가면균열의 시작값</small> <span class="ci-count">{{ ui.draft.base_crack }}</span></label>
            <input v-model.number="ui.draft.base_crack" type="range" min="0" max="100" step="5" />
            <div class="ci-scale"><span>철저히 감춤</span><span>다 드러남</span></div>
          </div>
        </section>

        <section>
          <h4>
            ② 충돌하는 가치 쌍 <small>({{ ui.draft.pairs.length }}/{{ LIMITS.max_pairs }})</small>
          </h4>
          <div v-for="(p, i) in ui.draft.pairs" :key="i" class="ci-pair">
            <div class="ci-pair-head">
              <input v-model="p.a" class="text_pole" :maxlength="LIMITS.pair_side" placeholder="가치 A (예: 정의)" />
              <span>vs</span>
              <input v-model="p.b" class="text_pole" :maxlength="LIMITS.pair_side" placeholder="가치 B (예: 동료)" />
              <button class="ci-del" type="button" title="이 쌍 삭제" @click="ui.draft.pairs.splice(i, 1)">🗑</button>
            </div>
            <div class="ci-field">
              <label>기우는 쪽 <span class="ci-count">{{ leanLabel(p) }}</span></label>
              <input v-model.number="p.lean" type="range" min="0" max="100" step="5" />
              <div class="ci-scale"><span>{{ p.b || 'B' }}</span><span>팽팽</span><span>{{ p.a || 'A' }}</span></div>
            </div>
            <div class="ci-field">
              <label>부딪힐 때 하는 행동 <span class="ci-count">{{ p.behavior.length }}/{{ LIMITS.pair_text }}</span></label>
              <textarea v-model="p.behavior" class="text_pole" rows="2" :maxlength="LIMITS.pair_text" />
            </div>
            <div class="ci-field">
              <label>반대로 골랐을 때의 대가 <span class="ci-count">{{ p.cost.length }}/{{ LIMITS.pair_text }}</span></label>
              <textarea v-model="p.cost" class="text_pole" rows="2" :maxlength="LIMITS.pair_text" />
            </div>
          </div>
          <button v-if="ui.draft.pairs.length < LIMITS.max_pairs" class="menu_button" type="button" @click="addPair">+ 가치 쌍 추가</button>
        </section>

        <details class="ci-preview">
          <summary>AI에게 들어가는 프롬프트 미리보기</summary>
          <pre>{{ preview }}</pre>
        </details>
      </div>

      <footer class="ci-foot">
        <button class="menu_button" type="button" :disabled="ui.busy" @click="runAnalysis">{{ ui.busy ? '분석 중…' : '다시 분석' }}</button>
        <span class="ci-spacer"></span>
        <button class="menu_button" type="button" @click="remove">삭제</button>
        <button class="menu_button" type="button" @click="close">닫기</button>
        <button class="menu_button ci-save" type="button" @click="save">저장</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { previewPrompt, refreshInjection, runAnalysis, ui } from './runtime';
import { LIMITS, Profile, ValuePair } from './schema';
import { deleteProfile, saveProfile } from './store';

const layer_fields = [
  { key: 'surface', label: '보여주는 모습', help: '남들이 보는 행동' },
  { key: 'desire', label: '진짜 욕구', help: '속으로 바라는 것' },
  { key: 'fear', label: '두려움·상처', help: '움직이게 만드는 원인' },
  { key: 'self_deception', label: '스스로 믿는 착각', help: '이야기가 흔들 수 있는 믿음' },
] as const;

const preview = computed(() => (ui.draft ? previewPrompt(Profile.parse(klona(ui.draft))) : ''));

function leanLabel(p: ValuePair) {
  const a = p.a || 'A';
  const b = p.b || 'B';
  if (p.lean > 55) return `${a} 쪽 ${p.lean}`;
  if (p.lean < 45) return `${b} 쪽 ${100 - p.lean}`;
  return '팽팽함';
}

function addPair() {
  ui.draft?.pairs.push(ValuePair.parse({}));
}

function close() {
  if (ui.draft_unsaved && !window.confirm('저장하지 않은 분석 결과가 있어요. 닫을까요?')) return;
  ui.editor_open = false;
  ui.draft_unsaved = false;
}

function save() {
  if (!ui.draft) return;
  try {
    saveProfile(ui.draft);
    ui.draft_unsaved = false;
    ui.editor_open = false;
    refreshInjection();
    toastr.success('저장했어요. 다음 답변부터 적용돼요.', '캐릭터 해석');
  } catch (e) {
    console.error('[캐릭터해석] save failed', e);
    toastr.error(String((e as Error).message ?? e), '저장 실패');
  }
}

function remove() {
  if (!window.confirm(`${ui.char_name}의 캐릭터 해석을 삭제할까요?`)) return;
  deleteProfile();
  ui.editor_open = false;
  ui.draft_unsaved = false;
  refreshInjection();
  toastr.info('삭제했어요.', '캐릭터 해석');
}
</script>

<style scoped>
.ci-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgb(0 0 0 / 55%);
}
.ci-modal {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(92vh, 100%);
  color: var(--SmartThemeBodyColor);
  background: var(--SmartThemeBlurTintColor, #222);
  border: 1px solid var(--SmartThemeBorderColor, #555);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgb(0 0 0 / 50%);
  backdrop-filter: blur(var(--SmartThemeBlurStrength, 8px));
}
.ci-head,
.ci-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
}
.ci-head {
  justify-content: space-between;
  border-bottom: 1px solid var(--SmartThemeBorderColor, #555);
}
.ci-foot {
  flex-wrap: wrap;
  border-top: 1px solid var(--SmartThemeBorderColor, #555);
}
.ci-spacer {
  flex: 1;
}
.ci-save {
  font-weight: bold;
}
.ci-x {
  background: none;
  border: none;
  color: inherit;
  font-size: 1.2em;
  cursor: pointer;
}
.ci-badge {
  margin-left: 8px;
  padding: 1px 6px;
  font-size: 0.8em;
  border: 1px solid currentColor;
  border-radius: 6px;
  opacity: 0.8;
}
.ci-body {
  overflow-y: auto;
  padding: 10px 14px;
}
.ci-hint {
  margin: 0 0 8px;
  font-size: 0.9em;
  opacity: 0.85;
}
section {
  margin-bottom: 14px;
}
h4 {
  margin: 6px 0;
}
.ci-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 6px 0;
}
.ci-field label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.92em;
}
.ci-field small {
  opacity: 0.65;
}
.ci-count {
  margin-left: auto;
  font-size: 0.8em;
  opacity: 0.65;
}
.ci-field textarea {
  width: 100%;
  margin: 0;
  resize: vertical;
}
.ci-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.78em;
  opacity: 0.65;
}
.ci-pair {
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--SmartThemeBorderColor, #555);
  border-radius: 8px;
}
.ci-pair-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ci-pair-head input {
  flex: 1;
  min-width: 0;
  margin: 0;
}
.ci-del {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
}
.ci-preview pre {
  max-height: 260px;
  overflow: auto;
  padding: 8px;
  font-size: 0.8em;
  white-space: pre-wrap;
  background: rgb(0 0 0 / 25%);
  border-radius: 6px;
}
</style>
