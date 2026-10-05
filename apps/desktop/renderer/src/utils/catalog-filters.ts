import type { ModelCategory } from "../../../../../packages/contracts/src/desktop.js";

export interface CatalogFilters {
  search: string;
  skillCategory: string;
  modelSearch: string;
  modelCategory: ModelCategory | "all";
}
