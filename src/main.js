import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { unmountGlobalLoading } from '../plugins/inject-app-loading/unmountGlobalLoading'

createApp(App).mount('#app')

unmountGlobalLoading()