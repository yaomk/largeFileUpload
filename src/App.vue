<template>
  <div class="page">
    <div class="page_top">
      <p>正在上传 ({{ statistics }})</p>
      <div
        class="page_top_right"
        :style="{
          'justify-content':
            uploadFileList.length > 1 ? 'space-between' : 'flex-end',
        }">
        <p
          class="clear_btn"
          @click="cancelAll"
          v-if="uploadFileList.length > 1">
          全部取消
        </p>
      </div>
    </div>
    <div class="content" ref="contentRef">
      <ListItem
        :uploadFileList="uploadFileList"
        @pauseUpload="pauseUpload"
        @resumeUpload="resumeUpload"
        @cancelSingle="cancelSingle"
        @delSingle="delSingle" />
    </div>

    <div class="bottom_box">
      <div class="input_btn">
        选择文件上传
        <input
          ref="inputEl"
          type="file"
          multiple
          class="is_input"
          @change="handleUploadFileChanage" />
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, reactive, computed, nextTick } from 'vue'
// import { uploadFile, checkFile, mergeChunk } from '@/api/index.js'
import ListItem from '#/components/ListItem.vue'
import fileWroker from '#/worker/fileWorker.js?worker'
import { mergeChunk, uploadFile, checkFile, delFile } from './api'
console.log(fileWroker)


// 切片大小，5M
const chunkSize = 1024 * 1024 * 5

const maxRequestNumber = ref(6)

// 上传文件列表
const uploadFileList = ref([])

const statistics = computed(() => {
  // 正在上传的文件个数 / 上传总数
  const otherArr = uploadFileList.value.filter((item) => item.state !== 4)
  return `${otherArr.length}/${uploadFileList.value.length}`
})

// 全部取消
const cancelAll = () => {
  new Set(uploadFileList.value).forEach(item => {
    cancelSingle(item)
  })
}

// 解析文件阶段，使用 Map 收集便于取消操作 worker
const workerMap = new WeakMap()

// 输入框change事件
const handleUploadFileChanage = async (e) => {
  const fileEl = e.target
  // 如果没有文件内容
  if (!fileEl || fileEl.files?.length === 0) {
    return false
  }
  const files = fileEl.files
  console.log(files)
    ;[...files].forEach(async (file, i) => {
      console.log({ file })
      // 需要使用 reactive 包裹，否则无法触发响应式追踪，视图不更新
      const inTaskArrItem = reactive({
        id: Date.now() + i,
        fileName: file.name,
        fileSize: file.size,
        state: 0, // 0什么都不做,1文件处理中,2上传中,3暂停,4上传完成,5上传中断，6上传失败
        sourceHash: '', // 文件原始hash
        fileHash: '', // 文件hash
        allChunkList: [], // 所有需要上传的切片，用于请求数据
        whileRequests: [], // 正在请求中的请求，目前是要永远都保存请求个数为6
        finishNumber: 0, //请求完成的个数
        errNumber: 0, // 报错的个数,默认是0个,超过3个就是直接上传中断
        percentage: 0, // 单个文件上传进度条
      })
      uploadFileList.value.push(inTaskArrItem)
      await nextTick()
      // 开始解析文件
      inTaskArrItem.state = 1
      if (!inTaskArrItem.fileSize) {
        inTaskArrItem.state = 6
        return
      }
      console.log("文件解析开始")
      const { percentage, fileHash, fileChunkList } = await useWorker(file, inTaskArrItem)
      console.log('文件解析完成, hash: ', fileHash)
      inTaskArrItem.percentage = percentage

      // 解析完成后开始上传
      const reg = /(.*)\..*/
      // 获取文件名，不包含后缀
      let baseName = reg.exec(file.name)[1]
      if (!baseName) {
        baseName = file.name
      }
      // 防止出现文件名不同但文件内容相同的情况，只要文件名不同，就应该视为不同的文件
      inTaskArrItem.fileHash = `${fileHash}${baseName}`
      inTaskArrItem.sourceHash = fileHash
      handleFileUploadStart(file, inTaskArrItem, fileChunkList)
    })
}

// web worker 解析文件: 文件切片，计算文件 md5
const useWorker = (file, inTaskArrItem) => {
  return new Promise(resolve => {
    const worker = new fileWroker()
    workerMap.set(inTaskArrItem, worker)
    worker.postMessage({
      file,
      chunkSize
    })
    worker.addEventListener('message', function (e) {
      console.log("主线程收到信息", e.data)
      const { percentage, fileHash, fileChunkList } = e.data
      inTaskArrItem.percentage = percentage
      if (fileHash) {
        resolve({
          percentage,
          fileHash,
          fileChunkList,
        })
      }
    })
    worker.addEventListener('error', err => {
      // 主线程可以监听 Worker 是否发生错误。如果发生错误，Worker 会触发主线程的 error 事件。
      console.log("%c主线程 worker error 监听事件: ", 'color: red', err,)
      worker.terminate()
    })
  })
}

/**
 * 文件开始上传
 * @param file File 文件对象
 * @param inTaskArrItem
 * @param fileChunkList
 */
const handleFileUploadStart = async (file, inTaskArrItem, fileChunkList) => {
  inTaskArrItem.state = 2
  inTaskArrItem.percentage = 0
  const res = await checkFile({fileName: inTaskArrItem.fileName, fileHash: inTaskArrItem.fileHash})
  if (!res.success) return
  const { shouldUpload, uploadedList } = res.data
  if (!shouldUpload) {
    console.log(`文件: ${file.name} 已存在，无需上传`)
    finishTask(inTaskArrItem)
    return
  }
  inTaskArrItem.allChunkList = fileChunkList.map((item, index) => {
    return {
      fileHash: inTaskArrItem.fileHash, // 总文件hash
      fileSize: file.size, // 文件总大小
      fileName: file.name, // 文件名称
      index: index, // 切片索引
      chunkFile: item.chunkFile, // 切片
      chunkHash: `${inTaskArrItem.sourceHash}-${index}`, // 切片hash
      chunkSize: item.chunkFile.size, // 切片文件大小
      chunkNumber: fileChunkList.length, // 切片个数
      finish: false, // 切片是否已经完成
      cancel: null, // 用于取消切片上传接口
    }
  })
  // 如果已存在部分文件切片，则过滤已经上传过的切片
  if (uploadedList.length) {
    inTaskArrItem.allChunkList = inTaskArrItem.allChunkList.filter(item => !uploadedList.includes(item.chunkHash))
  }
  // 如果需要上传，但是未缺少要上传的文件切片时，可能因为文件未合并
  if (!inTaskArrItem.allChunkList.length) {
    await handleMerge(inTaskArrItem)
    return
  }
  // 切片数量调整
  inTaskArrItem.allChunkList = inTaskArrItem.allChunkList.map(item => {
    return {
      ...item,
      chunkNumber: inTaskArrItem.allChunkList.length
    }
  })
  console.log(uploadFileList.value)
  uploadSignFile(inTaskArrItem)
}

// 文件切片合并
const handleMerge = async (item) => {
  const { fileName, fileHash } = item
  const res = await mergeChunk({ fileName, fileHash, chunkSize: chunkSize })
  if (res.success) {
    finishTask(item)
  } else {
    pauseUpload(item)
  }
  item.finishNumber = 0
}

// 单个文件上传
const uploadSignFile = async (item) => {
  // 如果没有需要上传的切片，或者正在上传的切片还未传完，就不做处理
  if (!item.allChunkList.length || item.whileRequests.length > 0) {
    return
  }
  // 过滤去需要上传的文件列表
  const isTaskArrIng = uploadFileList.value.filter(e => [1, 2].includes(e.state))
  // 动态计算并发请求数，每次调用前都获取一次最大并发数
  // chrome浏览器同域名同一时间请求的最大并发数限制为 6
  // 例如：有三个文件同时上传，那么每个文件切片的并发请求数最多为 6/3 = 2
  maxRequestNumber.value = Math.ceil(6 / isTaskArrIng.length)
  // 从尾部提取 maxRequestNumber 个需要上传的切片
  let whileRequests = item.allChunkList.slice(-maxRequestNumber.value)
  // 加入上传列表
  item.whileRequests.push(...whileRequests)
  // 将已加入上传列表的移出 allChunkList
  if (item.allChunkList.length > maxRequestNumber.value) {
    item.allChunkList.splice(-maxRequestNumber.value)
  } else {
    item.allChunkList = []
  }
  // 单个切片上传请求
  const uploadChunk = async (chunk = {}) => {
    const fd = new FormData()
    const { finish, cancel, ...rest } = chunk
    for (let key in rest) {
      fd.append(key, rest[key])
    }
    const res = await uploadFile(fd, cancelCb => {
      chunk.cancel = cancelCb
    })
    // 先判断是不是处于暂停还是取消状态
    // 你的状态都已经变成暂停或者中断了,就什么都不要再做了,及时停止
    if ([3, 5].includes(item.state)) return
    if (res.success) {
      // 单个文件上传失败次数大于 0 则要减少一个
      item.errNumber > 0 ? item.errNumber-- : 0
      // 单个文件切片上传成功数 +1
      item.finishNumber++
      // 单个切片上传完成
      chunk.finish = true
      // 更新进度条
      fileProgress(chunk, item)
      // 上传成功了就删掉请求中数组中的那个请求
      item.whileRequests.splice(item.whileRequests.findIndex(e => e.chunkFile === chunk.chunkFile), 1)
    } else {
      console.log(item)
      item.errNumber++
      // 超过3次之后直接上传中断
      if (item.errNumber > 3) {
        pauseUpload(item, false)
        console.log("切片上传失败超过三次了，中断上传")
      } else {
        // 失败了一片,继续当前分片请求
        uploadChunk(chunk)
      }
    }
    // 如果全部切片都上传完成了，则合并文件
    if (item.finishNumber === chunk.chunkNumber) {
      handleMerge(item)
    } else {
      uploadSignFile(item)
    }
  }
  // 每个切片开始上传
  for (const item of whileRequests) {
    uploadChunk(item)
  }
}

// 上传完成函数
const finishTask = (item) => {
  item.percentage = 100
  item.state = 4
}

// 暂停上传
const pauseUpload = (item, elsePause = true) => {
  // elsePause: true, 主动暂停上传，false为请求中断
  if (![4, 6].includes(item.state)) {
    item.state = elsePause ? 3 : 5
  }
  item.errNumber = 0
  if (item.whileRequests.length) {
    item.whileRequests.forEach(request => request.cancel?.())
  }
}

// 恢复上传
const resumeUpload = (item) => {
  item.state = 2
  item.allChunkList.push(...item.whileRequests)
  item.whileRequests = []
  uploadSignFile(item)
}

// 取消单个上传
const cancelSingle = (item) => {
  if (item.state === 1 && workerMap.has(item)) {
    console.log(workerMap.get(item))
    workerMap.get(item).terminate()
  } else {
    pauseUpload(item)
  }
  // 取消上传后删除该文件
  uploadFileList.value.splice(uploadFileList.value.indexOf(item), 1)
  handleInputFileDel()
}

// 删除已上传的文件
const delSingle = (item) => {
  delFile({ fileHash: item.fileHash , fileName: item.fileName})
  // 取消上传后删除该文件
  uploadFileList.value.splice(uploadFileList.value.indexOf(item), 1)
  handleInputFileDel()
}
const inputEl = ref()
const handleInputFileDel = () => {
  inputEl.value.value = ''
}

const fileProgress = (chunk, item) => {
  // 更新进度条
  item.percentage = Number(((item.finishNumber / chunk.chunkNumber) * 100).toFixed(2))
}
</script>

<style scoped lang="scss">
.page {
  margin: 0 auto;
  background-color: #28323e;
  width: 100%;
  height: 100vh;
  min-height: 500px;
  color: #ffffff;
  position: relative;
  display: flex;
  flex-direction: column;
}

.page_top {
  height: 48px;
  padding: 0 48px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: #8386be;
  flex: none;

  .page_top_right {
    width: 260px;
    display: flex;
  }

  .clear_btn {
    cursor: pointer;
    color: #b65658;
    user-select: none;

    &:hover {
      color: red;
    }
  }
}

.content {
  flex: 1;
  margin: 0 0 80px 0;
  overflow-y: auto;
  border-radius: 14px;
  background-color: #303944;
  border: 1px solid #252f3c;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.5) inset;
}

.bottom_box {
  text-align: center;
  position: absolute;
  bottom: 0;
  left: 0;
  height: 80px;
  width: 100%;
  display: flex;
  align-items: center;

  .input_btn > input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .input_btn {
    width: 200px;
    background-color: #409eff;
    opacity: 0.8;
    position: relative;
    padding: 8px 16px;
    border-radius: 8px;
    margin: 0 auto;
    user-select: none;
  }

  .input_btn:hover {
    opacity: 1;
  }
}
</style>