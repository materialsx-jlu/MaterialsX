---
name: materials-long-compute
description: Submit a user-approved frozen local computation, wait across app restarts, and retrieve its actual results through campaign_job. 用于已批准的长期本地计算；不生成或运行未审核脚本，也不提交远程作业。
---

# 长期本地计算 / Long-running local computation

Use `campaign_job` with `action=inputs` to inspect configurations frozen into the current research task. A user must create and approve the configuration in the research workspace first. Missing script, inputs or approval requires the configuration editor; a Skill cannot grant these permissions.

Submit with `action=submit`, the exact `configurationId` and a reason tied to the user's goal. The host records the original job and frozen inputs before dispatch. Currently this provider supports self-contained Node scripts on macOS, with no network or package installation; it does not execute Python, SSH or Slurm jobs.

For queued/running jobs, end this turn. The host pauses further model requests while the approved calculation runs. Pending, prepared and unknown states are not completion. Recovery must query the original owned `jobId` (`action=status`) before continuing; never submit another job to replace an unknown receipt. An `action=cancel` request is not proof of cancellation until a cancelled worker receipt arrives.

Once the host confirms successful exit and verifies required file hashes, inspect the result files, `job-summary.json` and `job-report.md`. Keep the recorded configuration, input hashes, environment and actual timings. Platform credits are zero for this offline provider; local resource cost is unmeasured. Scientific conclusions remain `needs_review`.

## Examples / 示例

- 使用研究工作区已批准的 NIST Norris 配置做后台参考计算。等待期间结束本轮，恢复前查询原任务，检查四个参考字段与真实报告。 / Run the approved NIST Norris configuration in the background. End the turn while waiting, query the original job before resuming, and inspect four reference checks and real reports.
- 查询原长期计算任务的状态；若完成，读取实际结果并说明限制。回执待核对时不重复提交。 / Query an existing long-running job; if complete, read its actual results and explain limitations. Do not resubmit an unconfirmed operation.
