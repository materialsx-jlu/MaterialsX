<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { UserRound } from "@lucide/vue";
import { ElMessage } from "element-plus";
import type { AccountSnapshot } from "../../../../../packages/contracts/src/desktop.js";
const props=withDefaults(defineProps<{locale?:"zh"|"en"}>(),{locale:"zh"});
const emit=defineEmits<{changed:[]}>();
const t=(zh:string,en:string)=>props.locale==="zh"?zh:en;
const account = ref<AccountSnapshot | null>(null);
const busy = ref(false);
const showDevices = ref(false);
const activeDevices = computed(() => (account.value?.devices.filter((device) => !device.revokedAt) ?? [])
  .sort((left, right) => Number(right.current) - Number(left.current)));
const visibleDevices = computed(() => showDevices.value ? account.value?.devices ?? [] : activeDevices.value.slice(0, 2));
async function refresh() { try { account.value = await window.materialsx.getAccount(); } catch { ElMessage.error("平台账户状态不可读取"); } }
async function action(kind: "login" | "logout", deviceId?: string) {
  busy.value = true;
  try { account.value = deviceId ? await window.materialsx.revokeAccountDevice(deviceId) : kind === "login"
    ? await window.materialsx.loginAccount() : await window.materialsx.logoutAccount();
    if(account.value.error) ElMessage.error(account.value.error); }
  catch { ElMessage.error(t("账户操作未完成，请检查身份服务连接后重试","Account operation did not finish. Check the account service connection and retry.")); }
  finally { busy.value = false; emit("changed"); }
}
async function more() {
  if (!account.value?.nextCursor) return;
  busy.value=true;
  try { const page=await window.materialsx.getAccountDevices(account.value.nextCursor);
    account.value.devices.push(...page.items); account.value.nextCursor=page.nextCursor; }
  catch { ElMessage.error("无法加载更多设备"); } finally {busy.value=false;}
}
function cancel() { void window.materialsx.cancelAccountLogin(); }
onMounted(refresh);
</script>
<template>
  <section class="account-panel">
    <div class="account-heading"><span class="account-icon"><UserRound :size="19" /></span><div><h3>{{t("平台账户","Platform account")}}</h3><p>{{t("查看登录状态和已授权设备。","View your sign-in status and authorized devices.")}}</p></div></div>
    <template v-if="account?.status === 'connected' && account.user">
      <div class="account-profile"><span class="account-avatar">{{ account.user.displayName.slice(0, 1).toUpperCase() }}</span><div><strong>{{ account.user.displayName }}</strong><small>{{ account.user.email }}</small></div><span class="account-connected">{{t("已登录","Connected")}}</span></div>
      <div class="account-device-heading"><strong>{{t("设备","Devices")}}</strong><button v-if="account.devices.length > 2 || account.nextCursor" type="button" @click="showDevices = !showDevices">{{showDevices ? t("收起","Show less") : t("查看全部","View all")}}</button></div>
      <div v-if="visibleDevices.length" class="account-devices"><div v-for="device in visibleDevices" :key="device.id" class="account-device"><span><strong>{{ device.name }}</strong><small>{{ device.current ? t("当前设备","Current device") : device.revokedAt ? t("已退出","Signed out") : t("已授权","Authorized") }}</small></span><button v-if="!device.revokedAt && !device.current" type="button" class="secondary-button" :disabled="busy" @click="action('logout', device.id)">{{t("退出","Sign out")}}</button></div></div>
      <p v-else class="account-help">{{t("没有其他已授权设备。","No other authorized devices.")}}</p>
      <button v-if="showDevices && account.nextCursor" class="account-text-button" type="button" :disabled="busy" @click="more">{{t("加载更多设备","Load more devices")}}</button>
      <button class="account-text-button" type="button" :disabled="busy" @click="action('logout')">{{t("退出账户","Sign out")}}</button>
    </template>
    <template v-else>
      <p class="account-help">{{ account?.error || (account?.status === 'unconfigured' ? t("平台账户服务尚未配置","Account service is not configured") : t("使用系统浏览器登录。密码不会进入桌面应用。","Sign in using your browser. Your password does not enter the desktop app.")) }}</p>
      <div class="account-actions"><button class="secondary-button" :disabled="busy || !account?.secureStorage || account?.status === 'unconfigured'" @click="action('login')">{{ busy ? t("等待浏览器授权…","Waiting for browser authorization…") : t("登录平台账户","Sign in") }}</button><button v-if="busy" class="secondary-button" @click="cancel">{{t("取消","Cancel")}}</button></div>
    </template>
    <p class="account-help">{{t("使用本地模型无需登录。","You can use local models without signing in.")}}</p>
  </section>
</template>
<style scoped>
.account-panel{padding:0 0 27px;margin-bottom:26px;border-bottom:1px solid var(--line-soft)}
.account-heading{display:flex;align-items:flex-start;gap:12px;margin-bottom:20px}.account-icon{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;background:var(--accent-bg);color:var(--accent)}
.account-heading h3{margin:1px 0 3px;font-size:16px;line-height:1.3}.account-heading p{margin:0;color:var(--muted);font-size:12px;line-height:1.5}
.account-profile{display:flex;align-items:center;gap:11px;min-width:0;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2)}
.account-avatar{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:9px;background:var(--accent-bg);color:var(--accent);font-size:14px;font-weight:700}
.account-profile div{min-width:0;flex:1}.account-profile strong,.account-profile small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-profile strong{font-size:13px}.account-profile small{margin-top:3px;color:var(--muted);font-size:12px}.account-connected{flex:none;color:var(--accent);font-size:11px}
.account-device-heading{display:flex;justify-content:space-between;align-items:center;margin:17px 0 5px;font-size:13px}.account-device-heading button,.account-text-button{padding:4px 0;border:0;background:none;color:var(--accent);font-size:12px;cursor:pointer}
.account-devices{max-height:190px;overflow:auto}.account-device{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line-soft)}.account-device span{min-width:0}.account-device strong,.account-device small{display:block;overflow-wrap:anywhere}.account-device strong{font-size:12px;font-weight:500}.account-device small{margin-top:2px;color:var(--muted);font-size:11px}.account-device .secondary-button{flex:none;min-height:29px;font-size:11px}
.account-text-button{display:block;margin-top:10px}.account-help{margin:12px 0 0;color:var(--muted);font-size:12px;line-height:1.55;overflow-wrap:anywhere}.account-actions{display:flex;gap:8px;margin-top:13px}
</style>
