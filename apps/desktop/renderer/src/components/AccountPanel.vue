<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import type { AccountSnapshot } from "../../../../../packages/contracts/src/desktop.js";
const props=withDefaults(defineProps<{locale?:"zh"|"en"}>(),{locale:"zh"});
const emit=defineEmits<{changed:[]}>();
const t=(zh:string,en:string)=>props.locale==="zh"?zh:en;
const account = ref<AccountSnapshot | null>(null);
const busy = ref(false);
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
  <section class="setting-section">
    <div class="section-title">平台账户 / Account</div>
    <template v-if="account?.status === 'connected' && account.user">
      <p>{{ account.user.displayName }} · {{ account.user.email }}</p>
      <div class="account-devices">
      <div v-for="device in account.devices" :key="device.id" class="account-device">
        <span>{{ device.name }}{{ device.current ? t(" · 当前设备"," · Current device") : '' }}{{ device.revokedAt ? t(" · 已退出"," · Signed out") : '' }}</span>
        <button v-if="!device.revokedAt" class="secondary-button" :disabled="busy" @click="action('logout', device.id)">{{t("退出设备","Sign out device")}}</button>
      </div>
      </div>
      <button v-if="account.nextCursor" class="secondary-button" :disabled="busy" @click="more">{{t("更多设备","More devices")}}</button>
      <button class="secondary-button" :disabled="busy" @click="action('logout')">退出账户 / Sign out</button>
    </template>
    <template v-else>
      <p class="field-help">{{ account?.error || (account?.status === 'unconfigured' ? t("平台账户服务尚未配置","Account service is not configured") : t("使用系统浏览器登录，密码不会进入桌面界面。","Sign in using the system browser. Your password does not enter the desktop interface.")) }}</p>
      <button class="secondary-button" :disabled="busy || !account?.secureStorage || account?.status === 'unconfigured'" @click="action('login')">{{ busy ? t("等待浏览器授权…","Waiting for browser authorization…") : t("登录","Sign in") }}</button>
      <button v-if="busy" class="secondary-button" @click="cancel">{{t("取消","Cancel")}}</button>
    </template>
    <p class="field-help">{{t("本地模型无需登录；平台模型当前为受限测试。正式收款尚未开启。","Local models require no account. Platform models are in limited testing; live sales are disabled.")}}</p>
  </section>
</template>
<style scoped>
.account-devices { max-height: 190px; overflow: auto; margin: 12px 0; }
.account-device { display: flex; gap: 10px; align-items: center; justify-content: space-between; font-size: 11px; padding: 10px 0; border-bottom: 1px solid var(--line-soft); }
.account-device span { min-width: 0; overflow-wrap: anywhere; }
.account-device .secondary-button { flex-shrink: 0; }
p { font-size: 12px; overflow-wrap: anywhere; }
</style>
