import { ref } from "vue";

export type AppearanceTheme = "materials-dark" | "codex-light";
export const appearanceThemes: Array<{ id: AppearanceTheme; name: string; description: string }> = [
  { id: "codex-light", name: "MaterialsX 浅色", description: "冷白工作区 · 深蓝灰导航 · 青蓝操作" },
  { id: "materials-dark", name: "MaterialsX 深色", description: "深蓝灰工作区 · 青蓝操作 · 柔和对比" },
];

const storageKey = "materialsx.appearance.theme";
export const appearanceTheme = ref<AppearanceTheme>("codex-light");

export function selectAppearanceTheme(theme: AppearanceTheme): void {
  appearanceTheme.value = theme;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(storageKey, theme); } catch { /* The theme still applies when storage is unavailable. */ }
}

export function initializeAppearance(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* Use the default theme. */ }
  selectAppearanceTheme(saved === "materials-dark" ? "materials-dark" : "codex-light");
}
