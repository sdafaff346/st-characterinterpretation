import { createScriptIdDiv, teleportStyle } from '@util/script';
import Editor from './Editor.vue';
import Panel from './Panel.vue';
import { bindSettings, bootRuntime, openEditor, runAnalysis } from './runtime';
import { useSettingsStore } from './store';

const BUTTON_ANALYZE = '캐해 분석';
const BUTTON_EDIT = '캐해 편집';

function init() {
  const pinia = createPinia();
  const settings_store = useSettingsStore(pinia);
  bindSettings(() => settings_store.settings);

  // Settings drawer in the Extensions panel
  const panel = createApp(Panel).use(pinia);
  const $panel = createScriptIdDiv().appendTo('#extensions_settings2');
  panel.mount($panel[0]);

  // Editor modal on the main page
  const editor = createApp(Editor).use(pinia);
  const $editor = createScriptIdDiv().appendTo('body');
  editor.mount($editor[0]);

  const { destroy } = teleportStyle();

  // Buttons above the input box (users can hide them in the script settings)
  appendInexistentScriptButtons([
    { name: BUTTON_ANALYZE, visible: true },
    { name: BUTTON_EDIT, visible: true },
  ]);
  eventOn(getButtonEvent(BUTTON_ANALYZE), () => runAnalysis());
  eventOn(getButtonEvent(BUTTON_EDIT), () => openEditor());

  bootRuntime();
  console.info('[캐릭터해석] loaded');

  $(window).on('pagehide', () => {
    uninjectPrompts(['character_insight', 'character_insight_mvu_rules', 'character_insight_mvu_format']);
    panel.unmount();
    editor.unmount();
    $panel.remove();
    $editor.remove();
    destroy();
  });
}

$(() => {
  errorCatched(init)();
});
