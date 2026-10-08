import {ref,watch} from 'vue';
function stored(key:string,fallback:string){try{return localStorage.getItem(key)??fallback}catch{return fallback}}
const locale=ref<'zh'|'en'>(stored('mx-ui-locale','zh')==='en'?'en':'zh');
const theme=ref<'light'|'dark'>(stored('mx-ui-theme','light')==='dark'?'dark':'light');
watch(locale,v=>{try{localStorage.setItem('mx-ui-locale',v)}catch{}});
watch(theme,v=>{try{localStorage.setItem('mx-ui-theme',v)}catch{}});
/** Only presentation preferences are persisted. Credentials remain outside browser storage. */
export function usePreferences(){return {locale,theme,t:(zh:string,en:string)=>locale.value==='zh'?zh:en}}
