import { ipcMain } from "electron";
import { z } from "zod";
import type { TeamResearchWorkspace } from "./team-research.js";
export function registerTeamResearchIpc(team: TeamResearchWorkspace) {
  const id = z.uuid();
  ipcMain.handle("team:overview", (_e, p) => team.getTeamResearch(id.parse(p)));
  ipcMain.handle("team:projects", () => team.listTeamProjects());
  ipcMain.handle("team:link", (_e, p, v, expected) =>
    team.saveTeamLink(
      id.parse(p),
      v,
      z.number().int().positive().parse(expected),
    ),
  );
  ipcMain.handle("team:manifest", (_e, p, v, expected) =>
    team.saveTeamManifest(
      id.parse(p),
      v,
      z.number().int().positive().parse(expected),
    ),
  );
  ipcMain.handle("team:import", (_e, p) =>
    team.importTeamManifest(id.parse(p)),
  );
  ipcMain.handle("team:member", (_e, p, account, input) =>
    team.changeTeamMember(id.parse(p), account, input),
  );
  ipcMain.handle("team:propose", (_e, p, input) =>
    team.proposeResearchCorrection(id.parse(p), input),
  );
  ipcMain.handle("team:review", (_e, p, c, input) =>
    team.reviewResearchCorrection(id.parse(p), id.parse(c), input),
  );
  ipcMain.handle("team:export", (_e, p, c) =>
    team.exportResearchCorrection(id.parse(p), id.parse(c)),
  );
  ipcMain.handle("team:confirm", (_e, p, c, input) =>
    team.confirmResearchCorrection(id.parse(p), id.parse(c), input),
  );
}
