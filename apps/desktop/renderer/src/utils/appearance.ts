import { ref } from "vue";

export type AppearanceTheme = "materials-dark" | "codex-light";
export const appearanceThemes: Array<{ id: AppearanceTheme; name: string; description: string }> = [
  { id: "materials-dark", name: "Materials 深色", description: "深色工作区 · 薄荷绿强调色" },
  { id: "codex-light", name: "Codex 浅色", description: "白色工作区 · 浅灰侧栏 · 黑色按钮" },
];

const storageKey = "materialsx.appearance.theme";
export const appearanceTheme = ref<AppearanceTheme>("materials-dark");

export function selectAppearanceTheme(theme: AppearanceTheme): void {
  appearanceTheme.value = theme;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(storageKey, theme); } catch { /* The theme still applies when storage is unavailable. */ }
}

export function initializeAppearance(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* Use the default theme. */ }
  selectAppearanceTheme(saved === "codex-light" ? "codex-light" : "materials-dark");
}
