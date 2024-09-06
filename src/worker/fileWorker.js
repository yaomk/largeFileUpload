import './spark-md5.min.js'

self.addEventListener('message', async e => {
  console.log(e)
  const { file, chunkSize } = e.data
  const fileChunkList = await createFileChunk(file, chunkSize)
  await calculateChunksHash(fileChunkList)
})

// console.log(self);
// 测试 error 监听事件
// setTimeout(() => {
//   console.log(a);
// }, 2000);

// worker 线程内部发生错误时触发，也会触发主线程的 error 事件
self.addEventListener('error', function (e) {
  console.log("%cWorker 线程 error 监听事件: ", 'color: red', e)
  // worker 线程关闭
  self.close()
})

// 创建文件切片
function createFileChunk(file, chunkSize) {
  return new Promise(resolve => {
    let fileChunkList = []
    let cur = 0
    while (cur < file.size) {
      fileChunkList.push({ chunkFile: file.slice(cur, cur + chunkSize) })
      cur += chunkSize
    }
    resolve(fileChunkList)
  })
}

// 记载并计算文件切片的 md5
async function calculateChunksHash(fileChunkList = []) {
  // debugger
  const spark = new SparkMD5.ArrayBuffer()

  // 计算切片进度
  let percentage = 0
  // 计算切片次数
  let count = 0

  try {
    const fileHash = await loadNext()
    self.postMessage({percentage: 100, fileHash, fileChunkList})
    self.close()
  } catch (err) {
    self.postMessage({name: 'error', data: err})
    self.close()
  }

  // 递归函数，处理文件的切片
  async function loadNext(index = 0) {
    // 所有的切片都已处理完毕
    if(index >= fileChunkList.length) {
      // 返回最终的MD5值
      return spark.end()
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsArrayBuffer(fileChunkList[index].chunkFile)
      reader.onload = e => {
        count++
        spark.append(e.target.result)
        percentage += 100 / fileChunkList.length
        self.postMessage({
          percentage
        })
        resolve(loadNext(index + 1))
      }
      reader.onerror = err => reject(err)
    })
  }
}