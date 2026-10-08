import { existsSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { ResearchModelSummary, SkillSummary } from "../../../packages/contracts/src/desktop.js";
import { parsePotentialRegistry } from "../../../packages/atomistic/src/registry.js";
import { loadJson } from "./store.js";

interface KdenseManifest {
  skills: string[];
}

interface KdenseConfig {
  enabledSkills: string[];
}

interface SkillCatalog {
  vendor: string;
  config: string;
  source: string;
  defaultLicense?: string;
}
const builtinCatalogs: SkillCatalog[] = [
  {vendor:'vendor/kdense-scientific-agent-skills',config:'skills/kdense-initial.json',source:'K-Dense Scientific Agent Skills'},
  {vendor:'vendor/materialsx-default-skills',config:'skills/materialsx-default.json',source:'MaterialsX 内置科研 Skills',defaultLicense:'AGPL-3.0-only'},
];
/** Current local instruction-file presence; avoid loading translations/examples/full instructions per model request. */
export function loadBuiltinSkillState(projectRoot:string) {
  return builtinCatalogs.flatMap(c=>{
    const manifest=loadJson<KdenseManifest>(join(projectRoot,c.vendor,'MANIFEST.json'));
    const enabled=new Set(loadJson<KdenseConfig>(join(projectRoot,c.config))?.enabledSkills??[]);
    return (manifest?.skills??[]).map(name=>{
      let installed=false;
      try{const file=lstatSync(join(projectRoot,c.vendor,'skills',name,'SKILL.md'));installed=file.isFile()&&file.size>0;}catch{/* Missing files remain explicit unavailable facts. */}
      return {name,installed,enabled:installed&&enabled.has(name)};
    });
  });
}

type SkillTranslations = Record<string, string>;
type SkillExamples = Record<string, Array<{ zh: string; en: string }>>;


interface SkillCategory {
  id: string;
  labelZh: string;
  labelEn: string;
  skills: string[];
}

interface ResearchModelCatalog {
  models: ResearchModelSummary[];
}


function scalar(source: string, key: string): string {
  return source.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

export function loadBuiltinSkills(projectRoot: string): SkillSummary[] {
  const taskMetadata = new Map((loadJson<{skills:Array<{name:string;execution:string;applicablePotentialIds:string[]}>}>(join(projectRoot,"skills/atomistic-m615.json"))?.skills??[]).map(s=>[s.name,s]));
  const categories = loadJson<SkillCategory[]>(join(projectRoot, "skills/categories.json")) ?? [];
  const skillCategories = new Map(categories.flatMap((category) =>
    category.skills.map((name) => [name, category] as const),
  ));
  const translations = loadJson<SkillTranslations>(join(projectRoot, "skills/descriptions.zh.json"));
  const englishDescriptions = loadJson<SkillTranslations>(join(projectRoot, "skills/descriptions.en.json"));
  const examples = loadJson<SkillExamples>(join(projectRoot, "skills/examples.json"));
  return builtinCatalogs.flatMap((catalog) => {
    const vendor = join(projectRoot, catalog.vendor);
    const manifest = loadJson<KdenseManifest>(join(vendor, "MANIFEST.json"));
    const config = loadJson<KdenseConfig>(join(projectRoot, catalog.config));
    const enabled = new Set(config?.enabledSkills ?? []);
    return (manifest?.skills ?? []).map((name) => {
      const category = skillCategories.get(name);
      const path = join(vendor, "skills", name, "SKILL.md");
      const skillSource = existsSync(path) ? readFileSync(path, "utf8") : "";
      const descriptionEn =
        englishDescriptions?.[name] || scalar(skillSource, "description") || "Materials science research workflow skill.";
      const descriptionZh = translations?.[name] || "材料科研工作流技能。";
      return {
        name,
        category: category?.id ?? "resources",
        categoryLabelZh: category?.labelZh ?? "资源与环境",
        categoryLabelEn: category?.labelEn ?? "Resources & environment",
        source: catalog.source,
        description: descriptionEn,
        descriptionZh,
        descriptionEn,
        examples: examples?.[name] ?? [],
        license: scalar(skillSource, "license") || catalog.defaultLicense || "待复核",
        enabled: enabled.has(name),
        ...(taskMetadata.has(name)?{availability:taskMetadata.get(name)!.execution==="planned-M6.5"?"planned" as const:"ready" as const,applicablePotentialIds:taskMetadata.get(name)!.applicablePotentialIds}:{}),
      };
    });
  });
}

export function loadResearchModels(projectRoot: string): ResearchModelSummary[] {
  return loadJson<ResearchModelCatalog>(join(projectRoot, "models/catalog.json"))?.models ?? [];
}

export function loadPotentialRegistry(projectRoot: string) {
  return parsePotentialRegistry(loadJson<unknown>(join(projectRoot, "models/potentials/registry.json")));
}
