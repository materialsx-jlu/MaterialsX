import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  teamProject,
  teamScope,
  teamMember,
  teamManifest,
  correctionSchema,
  type TeamProject,
  type TeamMember,
  type TeamManifest,
  type Correction,
} from "../../../contracts/src/team-research.js";
export const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** Project ACL/review metadata only. Account credentials and MOOS scientific facts stay in their original services. */
export class TeamStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS team_projects(id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS team_members(project_id TEXT NOT NULL,account_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(project_id,account_id));
 CREATE TABLE IF NOT EXISTS team_manifests(project_id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS team_corrections(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(project_id,request_id));
 CREATE TABLE IF NOT EXISTS team_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);`);
  }
  transaction<T>(fn: () => T) {
    const own = !this.db.isTransaction;
    if (own) this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      if (own) this.db.exec("COMMIT");
      return r;
    } catch (e) {
      if (own) this.db.exec("ROLLBACK");
      throw e;
    }
  }
  project(id: string): TeamProject {
    const r = this.db
      .prepare("SELECT body FROM team_projects WHERE id=?")
      .get(id);
    if (!r) throw Error("TEAM_NOT_FOUND");
    return teamProject.parse(JSON.parse(String(r.body)));
  }
  projects(accountId: string) {
    return this.db
      .prepare(
        "SELECT p.body FROM team_projects p JOIN team_members m ON p.id=m.project_id WHERE m.account_id=?",
      )
      .all(accountId)
      .map((r) => teamProject.parse(JSON.parse(String(r.body))))
      .filter((p) => this.member(p.id, accountId)?.active);
  }
  member(project: string, actor: string): TeamMember | null {
    const r = this.db
      .prepare(
        "SELECT body FROM team_members WHERE project_id=? AND account_id=?",
      )
      .get(project, actor);
    return r ? teamMember.parse(JSON.parse(String(r.body))) : null;
  }
  require(
    project: string,
    actor: string,
    roles: TeamMember["role"][] = ["reader", "editor", "reviewer"],
  ) {
    const m = this.member(project, actor);
    if (!m?.active || !roles.includes(m.role)) throw Error("TEAM_FORBIDDEN");
    return m;
  }
  create(input: Omit<TeamProject, "id" | "revision" | "updatedAt">) {
    return this.transaction(() => {
      const p = teamProject.parse({
        ...input,
        id: randomUUID(),
        revision: 1,
        updatedAt: new Date().toISOString(),
      });
      this.db
        .prepare("INSERT INTO team_projects VALUES(?,?)")
        .run(p.id, JSON.stringify(p));
      this.setMember(p.id, p.ownerId, {
        accountId: p.ownerId,
        role: "editor",
        active: true,
        revision: 1,
      });
      this.saveManifest(
        p.id,
        {
          materialSystem: "",
          conditions: [],
          notes: "",
          refs: [],
          revision: 1,
        },
        0,
      );
      this.audit(p.id, "local-operator", "project.created", p.id, p);
      return p;
    });
  }
  updateScopes(
    projectId: string,
    scopes: unknown,
    expected: number,
    reason: string,
  ) {
    return this.transaction(() => {
      const old = this.project(projectId);
      if (old.revision !== expected) throw Error("TEAM_CONFLICT");
      if (reason.trim().length < 5 || reason.length > 500)
        throw Error("TEAM_SCOPE_REASON_REQUIRED");
      const parsed = teamScope.array().max(100).parse(scopes);
      if (
        new Set(parsed.map((s) => s.sourceId + ":" + s.experimentId)).size !==
        parsed.length
      )
        throw Error("TEAM_DUPLICATE_SCOPE");
      const next = teamProject.parse({
        ...old,
        scopes: parsed,
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      this.db
        .prepare("UPDATE team_projects SET body=? WHERE id=?")
        .run(JSON.stringify(next), projectId);
      this.audit(
        projectId,
        "local-operator",
        "project.scope-changed",
        projectId,
        { revision: next.revision, scopes: parsed, reason },
      );
      return next;
    });
  }
  setMember(project: string, actor: string, value: TeamMember) {
    const m = teamMember.parse(value);
    this.db
      .prepare(
        "INSERT INTO team_members VALUES(?,?,?) ON CONFLICT(project_id,account_id) DO UPDATE SET body=excluded.body",
      )
      .run(project, actor, JSON.stringify(m));
    return m;
  }
  members(id: string) {
    return this.db
      .prepare("SELECT body FROM team_members WHERE project_id=? LIMIT 201")
      .all(id)
      .map((r) => teamMember.parse(JSON.parse(String(r.body))));
  }
  manifest(project: string): TeamManifest {
    const r = this.db
      .prepare("SELECT body FROM team_manifests WHERE project_id=?")
      .get(project);
    if (!r) throw Error("TEAM_NOT_FOUND");
    return teamManifest.parse(JSON.parse(String(r.body)));
  }
  saveManifest(project: string, value: TeamManifest, expected: number) {
    const v = teamManifest.parse(value);
    if (
      (expected && this.manifest(project).revision !== expected) ||
      v.revision !== expected + 1
    )
      throw Error("TEAM_CONFLICT");
    this.db
      .prepare(
        "INSERT INTO team_manifests VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET body=excluded.body",
      )
      .run(project, JSON.stringify(v));
    return v;
  }
  corrections(project: string) {
    return this.db
      .prepare(
        "SELECT body FROM team_corrections WHERE project_id=? ORDER BY rowid DESC LIMIT 200",
      )
      .all(project)
      .map((r) => correctionSchema.parse(JSON.parse(String(r.body))));
  }
  correction(project: string, id: string) {
    const r = this.db
      .prepare("SELECT body FROM team_corrections WHERE project_id=? AND id=?")
      .get(project, id);
    if (!r) throw Error("TEAM_NOT_FOUND");
    return correctionSchema.parse(JSON.parse(String(r.body)));
  }
  request(project: string, id: string) {
    const r = this.db
      .prepare(
        "SELECT body FROM team_corrections WHERE project_id=? AND request_id=?",
      )
      .get(project, id);
    return r ? correctionSchema.parse(JSON.parse(String(r.body))) : null;
  }
  saveCorrection(value: Correction, expected: number | null) {
    const v = correctionSchema.parse(value);
    if (expected === null)
      this.db
        .prepare("INSERT INTO team_corrections VALUES(?,?,?,?)")
        .run(v.id, v.projectId, v.input.requestId, JSON.stringify(v));
    else {
      const old = this.correction(v.projectId, v.id);
      if (old.revision !== expected || v.revision !== expected + 1)
        throw Error("TEAM_CONFLICT");
      this.db
        .prepare(
          "UPDATE team_corrections SET body=? WHERE id=? AND project_id=?",
        )
        .run(JSON.stringify(v), v.id, v.projectId);
    }
    return v;
  }
  audit(
    project: string,
    actor: string,
    action: string,
    target: string,
    detail: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO team_audit(project_id,actor_id,action,target_id,detail_sha256,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        project,
        actor,
        action,
        target,
        digest(detail),
        new Date().toISOString(),
      );
  }
  events(project: string) {
    return this.db
      .prepare(
        "SELECT sequence,project_id AS projectId,actor_id AS actorId,action,target_id AS targetId,detail_sha256 AS detailSha256,created_at AS createdAt FROM team_audit WHERE project_id=? ORDER BY sequence DESC LIMIT 100",
      )
      .all(project);
  }
  close() {
    this.db.close();
  }
}
