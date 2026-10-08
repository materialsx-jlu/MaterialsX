-- 0 means no request-count ceiling. Existing tasks retain their frozen budgets.
ALTER TABLE research_tasks DROP CONSTRAINT research_tasks_max_requests_check;
ALTER TABLE research_tasks ADD CHECK(max_requests>=0);
ALTER TABLE research_tasks DROP CONSTRAINT research_tasks_max_output_tokens_check;
ALTER TABLE research_tasks ADD CHECK(max_output_tokens BETWEEN 1 AND 131072);
ALTER TABLE research_tasks DROP CONSTRAINT research_tasks_max_duration_seconds_check;
ALTER TABLE research_tasks ADD CHECK(max_duration_seconds BETWEEN 1 AND 86400);
