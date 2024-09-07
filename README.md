# 大文件上传：（web Worker计算切片，断点续传，暂停上传，秒传）
大致原理：
* 将大文件按照一定的大小进行分割，并将切片按照次序编号。
* 将切片一个个发送到服务端。
* 全部切片提交到服务端后，将切片合并为一个文件。
* 如果再次上传同一个文件时，由于 `hash` 值相同，不在重新发送到服务端，即为**秒传**。

## 创建文件切片
* `File` 对象是一种特定类型的 `Blob`，继承了 `Blob` 接口的属性。
* `Blob` 实例对象可以通过 `slice()` 方法获取子集 `blob`。

```js
// worker.js 子线程内
/**
 * 创建文件切片
 * @param {File} file
 * @param {Number} chunkSize 切片大小
 */
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
```
### 计算文件 hash
使用 `spark-md5.js` 三方库，分块读取文件并计算文件 md5 值。

```js
import SparkMD5 from 'spark-md5'
const spark = new SparkMD5.ArrayBuffer()

// 文件的md5值
let fileHash = ''

function sparkAppendChunk(chunk) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsArrayBuffer(chunk)
    reader.onload = function(e) {
      spark.append(e.target.result)
      resolve()
    }
    reader.onerror = function(e) {
      reject(e)
    }
  })
}

for(let index in fileChunkList) {
  await sparkAppendChunk(fileChunkList[index].chunkFile)
  if(index == fileChunkList.length - 1) {
    // 所有的文件切片都读取完成，计算最终的 MD5
    fileHash = spark.end()
  }
}
```


## web Worker 使用

如果文件过大，在主线程中进行文件切片，计算文件 `hash`(主要用于确定文件的唯一性与完整性)，会导致 `UI` 阻塞，出现假死现象。所以，需要使用 `web Worker`。

### Worker 使用注意点

* 同源限制
必须与主线程的脚本同源。

* DOM 限制
无法读取主线程的 DOM，无法使用 `document`、`window`、`parent` 等对象，但 `Worker` 可以使用 `navigator`、`location` 等对象。

* 通信联系
`Worker` 线程与主线程不在同一上下文环境，必须通过消息完成（postMessage，message 事件）。

* 脚本限制
`Worker` 线程不能执行 `alert()`、`confirm()`、`prompt()` 等函数。但可以发起请求。

* 文件限制
`Worker` 线程无法读取本地文件，即不能打开本机的文件系统（`file://`），它所加载的脚本，必须来自网络。

### Worker 的基本使用

#### 主线程相关基本使用
* 主线程调用 `Worker` 构造函数，新建一个 `worker` 线程。

```js
const worker = new Worker('./worker.js')
```

* 主线程可以调用  `worker.postMessage()` 向 `Worker` 发送消息。
> postMessage() 方法的参数，就是主线程传递给 worker 线程的数据，必须是可以被结构化克隆算法处置的 javascript 对象。function、dom 节点、getter、setter 等不被支持。作为参数时可能会产生异常，或被丢弃。
```js
worker.postMessage('hello world')
worker.postMessage({content: 'hello world', type: 'text'})
```

* 主线程可以通过 `worker.onmessage` 指定函数监听 `Worker` 子线程发送的消息。

```js
worker.onmessage = function(e) {
  // 子线程发送过来的信息
  console.log(e.data)
}
// 或使用 addEventListener
worker.addEventListener('message', function(e) {
  console.log(e.data)
})
```

* 当 `Worker` 完成任务时，主线程需要关闭 `Worker` 子线程，以便节省系统资源。

```js
worker.terminate()
```

#### Worker 子线程相关基本使用

* `Worker` 子线程内部需要监听函数，监听主线程发送过来的 `message` 事件。子线程同样使用 `postMessage()` 方法向主线程发送消息。

```js
self.addEventListener('message', function(e) {
  // 主线程发送过来的信息
  console.log(e.data)
  // 子线程向主线程发送信息
  self.postMessage({content: 'hello world', type: 'text'})
})
// 或使用 onmessage
slef.onmessage = function(e) {}
```

* `self` 代表子线程自身，即子线程的全局对象。因此，等同于下面的写法：

```js
this.onmessage = function(e) {}
onmessage = function(e) {}
this.self.onmessage = function(e) {}
```
* 子线程可以在内部关闭自身。

```js
self.close()
```

#### Worker 内加载脚本

`Worker` 内部如果要加载其他脚本，可以使用 `importScripts()` 方法。

```js
importScripts('./utils.js')
// 可以同时加载多个脚本
importscripts('./utils.js', './utils2.js')
```

#### 错误处理
主线程和子线程都可以监听 `error` 事件。

```js
// 主线程
worker.onerror = function(e) {}
// 子线程内
self.onerror = function(e) {}
```

## 取消请求

可以使用 `AbortController` 构造函数创建一个实例对象，将 signal 随请求传递，使用 abort 中止请求。

```js
const controller = new AbortController()

const signal = controller.signal
axios.post(url, data, { signal })

// 中止携带了 signal 的请求
controller.abort()
```










