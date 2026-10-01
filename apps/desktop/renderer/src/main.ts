import { createApp } from "vue";
import { createPinia } from "pinia";
import "element-plus/theme-chalk/base.css";
import "element-plus/theme-chalk/el-drawer.css";
import "element-plus/theme-chalk/el-input.css";
import "element-plus/theme-chalk/el-message.css";
import "katex/dist/katex.min.css";
import App from "./App.vue";
import "./styles.css";
import "./themes.css";
import { initializeAppearance } from "./utils/appearance";

initializeAppearance();
createApp(App).use(createPinia()).mount("#app");
