import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessOperations } from './od6-monitor.mjs';
test('monitor separates missing services, pending usage, payments, catalog and MOOS',()=>{
 const alerts=assessOperations({services:{identity:false,litellm:true},metrics:{database:{reconciliationPending:21,agedPendingOrders:6,databaseBytes:22*1024**3},routes:{auth:{Logins:1,LoginFailures:11},model_gateway:{Requests:10,ProxyTimeouts:10,FirstByteTotalMs:500000}}},expectedCatalogRevision:'a',catalogRevision:'b',moosConfigured:true,moosHealthy:false});
 assert.ok(alerts.includes('identity:unavailable'));
 for(const key of ['billing:reconciliation_backlog','payments:aged_orders','database:space_threshold','auth:login_failure_rate','models:proxy_timeouts','models:first_byte_slow','catalog:revision_drift','moos:unavailable'])assert.ok(alerts.includes(key),key);
});
test('configured LiteLLM database absence is an actionable alert',()=>{
 const alerts=assessOperations({services:{},metrics:{database:{reconciliationPending:0,agedPendingOrders:0,databaseBytes:1}},litellmDatabaseConfigured:true,litellmDatabaseBytes:null});
 assert.ok(alerts.includes('litellm_database:unavailable'));
});
