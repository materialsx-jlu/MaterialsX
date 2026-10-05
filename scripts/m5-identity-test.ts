import { spawnSync } from "node:child_process";
if (!process.env.MATERIALSX_IDENTITY_TEST_DATABASE_URL) throw new Error("Set an isolated MATERIALSX_IDENTITY_TEST_DATABASE_URL naming a test database; skipped DB tests do not count as acceptance");
const result=spawnSync("go",["-C","services/control-plane","test","-race","./...","-count=1"],{stdio:"inherit",env:process.env});
process.exitCode=result.status??1;
