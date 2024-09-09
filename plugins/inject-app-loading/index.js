import { resolve } from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// 用于获取 loading 的html模板
function getLoadingRawByHtmlTemplate(loadingTemplate) {
  let appLoadingPath = resolve(process.cwd(), loadingTemplate)
  // 如果给定的模板路径不存在，使用默认模版
  if (!fs.existsSync(appLoadingPath)) {
    const __dirname = fileURLToPath(new URL('.', import.meta.url))
    appLoadingPath = resolve(__dirname, './default-loading.html')
  }
  return fsp.readFile(appLoadingPath, 'utf-8')
}

// 在html中插入全局loading
async function viteInjectAppLoadingPlugin(loadingTemplate = 'loading.html') {
  const loadingHtml = await getLoadingRawByHtmlTemplate(loadingTemplate)
  if (!loadingHtml) return
  return {
    // pre 强制在 vite 核心插件之前调用该插件
    enforce: 'pre',
    name: 'vite:inject-app-loading',
    // vite 独有的钩子之一：transformIndexHtml，转换 index.html 的专用钩子。
    transformIndexHtml: {
      handler(html) {
        const re = /<body\s*>/
        html = html.replace(re, `<body>${loadingHtml}`)
        return html
      },
      // 处理 HTML 之前应用
      order: 'pre'
    }
  }
}



export { viteInjectAppLoadingPlugin, }