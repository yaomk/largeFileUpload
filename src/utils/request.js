import axios from 'axios'

const baseUrl = '/api'

// 创建 axios 实例
const service = axios.create({
  baseURL: baseUrl,
  // 超时时间
  timeout: 30 * 1000
})

service.interceptors.request.use(
  config => {
    return config
  },
  err => {
    return Promise.reject(err)
  }
)

// 响应拦截
service.interceptors.response.use(
  res => {
    return res.data
  },
  err => {
    return Promise.reject({
      code: -1,
      data: err,
      msg: err.message,
      success: false
    })
  }
)

export default service