import request from '#/utils/request'
import { ElMessage } from 'element-plus'

export function uploadFile(data, cancelCb) {
  // 创建 AbortController 对象, 用于取消请求
  const controller = new AbortController()
  const signal = controller.signal

  if (typeof cancelCb === 'function') {
    // 用于接收 取消请求的回调函数
    cancelCb(() => controller.abort())
  }
  return handleAxiosPromise(
    request({
      url: '/upload',
      method: 'post',
      data,
      signal, // 请求携带上 signal
    })
  )
}

export function mergeChunk(data) {
  return handleAxiosPromise(
    request({
      url: '/merge',
      method: 'post',
      data
    })
  )
}

export function checkFile(data) {
  return handleAxiosPromise(
    request({
      url: '/verify',
      method: 'post',
      data
    })
  )
}

export function delFile(data) {
  return handleAxiosPromise(
    request({
      url: '/delFile',
      method: 'post',
      data
    })
  )
}

// 获取 Promise 错误信息和返回值
function handlePromise(promise) {
  try {
    return promise.then(data => [null, data]).catch(err => [err])
  } catch (err) {
    return [err]
  }
}

async function handleAxiosPromise(axiosRequest, showErrMessage = true) {
  const [err, res] = await handlePromise(axiosRequest)
  console.log(err, res)
  if (err) {
    if (showErrMessage) {
      ElMessage.error({
        message: err.msg,
      })
    }
    return err
  }
  return res
}