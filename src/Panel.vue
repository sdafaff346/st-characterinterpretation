<template>
  <div class="ci-panel">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>캐릭터 해석 (겉과 속 · 충돌 가치)</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="ci-status">
          <span>캐릭터: <b>{{ ui.char_name ?? '없음 (1:1 채팅에서 사용)' }}</b></span>
          <span>MVU: <b :class="ui.mvu_ready ? 'ci-ok' : 'ci-off'">{{ ui.mvu_ready ? '감지됨' : '없음 (고정 모드)' }}</b></span>
        </div>

        <div class="flex-container">
          <input class="menu_button" type="button" :value="ui.busy ? '분석 중…' : '카드 분석'" :disabled="ui.busy" @click="runAnalysis" />
          <input class="menu_button" type="button" value="편집 열기" @click="openEditor" />
        </div>

        <hr class="sysHR" />

        <label class="checkbox_label"><input v-model="settings.enabled" type="checkbox" /> 답변 생성 때 주입하기</label>

        <div class="ci-row">
          <label>주입 깊이 (0 = 맨 끝)</label>
          <input v-model.number="settings.inject_depth" class="text_pole" type="number" min="0" max="20" />
        </div>
        <div class="ci-row">
          <label>주입 역할</label>
          <select v-model="settings.inject_role" class="text_pole">
            <option value="system">system</option>
            <option value="user">user</option>
            <option value="assistant">assistant</option>
          </select>
        </div>
        <div class="ci-row">
          <label>분석 결과 언어</label>
          <select v-model="settings.output_language" class="text_pole">
            <option value="ko">한국어</option>
            <option value="en">영어</option>
            <option value="card">카드와 같은 언어</option>
          </select>
        </div>

        <hr class="sysHR" />
        <b>MVU 연동</b>
        <label class="checkbox_label"><input v-model="settings.mvu_enabled" type="checkbox" /> 가면 균열·가치 기울기를 MVU 변수로 추적</label>
        <label class="checkbox_label"><input v-model="settings.mvu_inject_rules" type="checkbox" /> 변수 갱신 규칙 주입</label>
        <label class="checkbox_label" title="카드에 이미 [mvu_update]변수출력형식 항목이 있으면 끄세요">
          <input v-model="settings.mvu_inject_format" type="checkbox" /> 변수 출력 형식도 주입 (MVU 카드가 아닐 때만)
        </label>
        <div class="ci-row">
          <label>한 턴 최대 변화량</label>
          <input v-model.number="settings.mvu_max_delta" class="text_pole" type="number" min="1" max="50" />
        </div>
        <hr class="sysHR" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { openEditor, refreshInjection, runAnalysis, ui } from './runtime';
import { useSettingsStore } from './store';

const { settings } = storeToRefs(useSettingsStore());
watch(settings, () => refreshInjection(), { deep: true });
</script>

<style scoped>
.ci-status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 4px 0 8px;
  font-size: 0.9em;
}
.ci-ok {
  color: var(--active, #6c6);
}
.ci-off {
  opacity: 0.7;
}
.ci-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 4px 0;
}
.ci-row .text_pole {
  max-width: 10em;
  margin: 0;
}
</style>
