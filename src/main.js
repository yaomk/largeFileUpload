import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
// import zhCn from 'element-plus/es/locale/lang/zh-cn'
// import ElementPlus from 'element-plus'
import { unmountGlobalLoading } from '../plugins/inject-app-loading/unmountGlobalLoading'
import 'element-plus/theme-chalk/dark/css-vars.css'
import "element-plus/theme-chalk/src/message.scss"

const app = createApp(App)
// app.use(ElementPlus, {locale: zhCn, message: { max: 5, grouping: true } })
app.mount('#app')

unmountGlobalLoading()