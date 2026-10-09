export function assessOperations(input, limits = {}) {
  const alerts = [];
  for (const [name, ok] of Object.entries(input.services || {})) if (!ok) alerts.push(`${name}:unavailable`);
  const db=input.metrics?.database;
  if (!db) alerts.push('database:metrics_unavailable');
  else {
    if (db.reconciliationPending > (limits.pending ?? 20)) alerts.push('billing:reconciliation_backlog');
    if (db.agedPendingOrders > (limits.orders ?? 5)) alerts.push('payments:aged_orders');
    if (db.databaseBytes > (limits.databaseBytes ?? 20*1024**3)) alerts.push('database:space_threshold');
  }
  if(input.litellmDatabaseConfigured && input.litellmDatabaseBytes===null)alerts.push('litellm_database:unavailable');
  if(input.litellmDatabaseBytes>(limits.databaseBytes??20*1024**3))alerts.push('litellm_database:space_threshold');
  const routes=input.metrics?.routes||{};
  const auth=routes.auth;
  if (auth && auth.Logins+auth.LoginFailures>=10 && auth.LoginFailures/(auth.Logins+auth.LoginFailures)>0.5) alerts.push('auth:login_failure_rate');
  const proxy=routes.model_gateway;
  if (proxy?.ProxyTimeouts>=(limits.proxyTimeouts ?? 10)) alerts.push('models:proxy_timeouts');
  if (proxy?.Requests>=10 && proxy.FirstByteTotalMs/proxy.Requests>(limits.firstByteMs ?? 30000)) alerts.push('models:first_byte_slow');
  if (proxy?.FirstTokenCount>=10 && proxy.FirstTokenTotalMs/proxy.FirstTokenCount>(limits.firstTokenMs ?? 45000)) alerts.push('models:first_token_slow');
  if(input.expectedCatalogRevision&&input.catalogRevision!==input.expectedCatalogRevision)alerts.push('catalog:revision_drift');
  if(input.moosConfigured&&!input.moosHealthy)alerts.push('moos:unavailable');
  if(input.moosFailures>=(limits.moosFailures??5))alerts.push('moos:read_failures');
  return alerts;
}
