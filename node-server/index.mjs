import express from 'express'
import { resolve, join } from 'node:path'
import fse from 'fs-extra'
import multiparty from 'multiparty'
import { Buffer } from 'node:buffer'

const app = express()
const port = 3000

app.use((req, res, next) => {
  // 允许跨域
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  next()
})
app.options('*', (req, res) => {
  res.sendStatus(200)
})

app.listen(port, () => console.log('文件上传接口启动： 监听端口：' + port))

// 文件存储目录
const UPLOAD_DIR = resolve(import.meta.dirname, 'fileTarget')

// 上传
app.post('/upload', async (req, res) => {
  console.log(req)
  try {
    // 处理文件表单
    const form = new multiparty.Form()
    form.parse(req, async (err, fields, files) => {
      // fields 是一个对象，其属性名称是字段名称，值是字段值数组。
      // files 是一个对象，其属性名称是字段名称，值是文件对象数组。
      if (err) {
        res.send(createResponse(20000, err, '切片上传失败'))
        return
      }
      // fileds 是 formdata 中的数据
      // 文件hash，切片hash，文件名称
      const { fileHash, chunkHash, fileName } = fields
      // files 是传过来的文件所在的真实路径以及内容
      const { chunkFile } = files
      // 创建一个临时文件目录用于临时存储所有文件切片
      const chunkCache = getChunkDir(fileHash)
      // 如果临时目录不存在则创建
      if (!fse.existsSync(chunkCache)) {
        await fse.mkdirs(chunkCache)
      }
      // 将上传的文件切片移动到指定的存储文件目录
      // fse.move 方法默认不会覆盖已经存在的文件。
      // 将 overwrite: true 设置为 true，这样当目标文件已经存在时，将会被覆盖。
      // 把上传的文件移动到 /fileTarget/chunkCache_fileHash/chunkHash
      await fse.move(chunkFile[0].path, `${chunkCache}/${chunkHash}`, { overwrite: true })
      const data = { fileHash: fileHash.toString(), chunkHash: chunkHash.toString(), fileName: fileName.toString() }
      res.send(createResponse(10000, data, '切片上传成功'))
    })
  } catch (error) {
    res.send(createResponse(20000, error, '切片上传失败'))
  }
})

// 合并切片
app.post('/merge', async (req, res) => {
  try {
    const data = await resolvePost(req)
    console.log(data)
    const { fileHash, fileName, chunkSize } = data
    const ext = extractExt(fileName)
    const filePath = resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    await mergeFileChunk({ filePath, fileHash, chunkSize })
    res.send(createResponse(10000, '', '文件合并成功'))
  } catch (error) {
    res.send(createResponse(20000, error, '文件合并失败'))
  }
})

// 验证文件是否已存在
app.post('/verify', async (req, res) => {
  try {
    const data = await resolvePost(req)
    const { fileHash, fileName } = data
    const ext = extractExt(fileName)
    const filePath = resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    if (fse.existsSync(filePath)) {
      res.send(createResponse(10000, { shouldUpload: false, uploadedList: [] }, '已存在该文件'))
    } else {
      res.send(createResponse(10000, { shouldUpload: true, uploadedList: await createUploadedList(fileHash) }, '需要上传文件或部分切分'))
    }
  } catch (error) {
    res.send(createResponse(20000, error, '上传失败'))
  }
})

app.post('/delFile', async (req, res) => {
  try {
    const data = await resolvePost(req)
    const { fileHash, fileName } = data
    const ext = extractExt(fileName)
    const filePath = resolve(UPLOAD_DIR, `${fileHash}${ext}`)
    if (fse.existsSync(filePath)) {
      fse.remove(filePath).then(() => {
        res.send(createResponse(10000, '', '删除成功'))
      }).catch((err) => {
        res.send(createResponse(20000, err, '删除失败'))
      })
    } else {
      res.send(createResponse(20000, '', '文件不存在'))
    }
  } catch (error) {
    res.send(20000, error, '删除失败')
  }
})

const createResponse = (code, data, msg = '操作成功',) => {
  if (!data) {
    data = null
  }
  const response = { success: true, code, msg, data }
  if (code !== 10000) {
    response.success = false
  }
  return response
}

// 用于创建临时文件夹用于临时存储所有的文件切片
const getChunkDir = (fileHash) => {
  // 添加 chunkCache 前缀与文件名做区分
  // fileTarget/chunkCache_fileHash
  return resolve(UPLOAD_DIR, `chunkCache_${fileHash}`)
}

// 用于解析请求参数
const resolvePost = (req) => {
  // 所有接收到的数据块拼接成一个字符串，然后解析为 JSON 对象。
  return new Promise((resolve, reject) => {
    let body = []
    // let strData = ''
    // 监听请求对象 req 的 data 事件。每当有数据块传输过来时，处理程序就会被调用。
    req.on('data', data => {
      // data的类型为 buffer，使用数组接收，可以避免大字符串占用内存高的问题
      // strData += data
      body.push(data)
    })
    req.on('end', () => {
      // 使用 Buffer.concat 将所有数据块合并为一个 Buffer
      const buffer = Buffer.concat(body)
      // 将 Buffer 转换为字符串（假设是 UTF-8 编码）
      const stringData = buffer.toString('utf8')
      try {
        // JSON.parse(strData)
        const parsedData = JSON.parse(stringData)
        resolve(parsedData)
      } catch (error) {
        reject(new Error('参数解析失败'))
      }
    })
    req.on('error', err => {
      reject(err)
    })
  })
}

// 获取文件后缀
const extractExt = (fileName = '') => {
  // 查找'.'在fileName中最后出现的位置
  const lastIndex = fileName.lastIndexOf('.')
  // 如果'.'不存在，则返回空字符串
  if (lastIndex === -1) {
    return ''
  }
  // 否则，返回从'.'后一个字符到fileName末尾的子串作为文件后缀（包含'.'）
  return fileName.slice(lastIndex)
}

// 合并切片
const mergeFileChunk = async ({ chunkSize, fileHash, filePath }) => {
  try {
    const chunkCache = getChunkDir(fileHash)
    // 读取临时所有切片目录 chunkCache 下的所有文件和子目录，并返回这些文件和子目录的名称。
    const chunkPaths = await fse.readdir(chunkCache)

    // 根据切片下标进行排序
    chunkPaths.sort((a, b) => a.split('.')[1] - b.split('.')[1])

    let promiseList = []
    for (let i = 0; i < chunkPaths.length; i++) {
      // fileTarget/chunkCache_fileHash/chunkHash 文件切片位置
      const chunkPath = resolve(chunkCache, chunkPaths[i])
      // 根据 index * chunkSize 在指定位置创建可写流
      const writeStream = fse.createWriteStream(filePath, {
        start: i * chunkSize,
      })
      promiseList.push(pipStream(chunkPath, writeStream))
    }
    // 等待所有切片处理完成
    return Promise.all(promiseList).then(() => {
      console.log("所有文件切片已成功处理并删除")
      // 如果文件切片存在，则删除
      if (fse.pathExistsSync(chunkCache)) {
        fse.remove(chunkCache)
        console.log(`chunkCache目录:${chunkCache}已删除`)
      } else {
        console.log(`${chunkCache} 不存在，不能删除`)
      }
      return Promise.resolve()
    }).catch((error) => {
      return Promise.reject(`'合并切片失败：${error}`)
    }
    )
  } catch (error) {
    console.log("切片合并过程中发生错误：", error)
    return Promise.reject(`'合并切片失败：${error}`)
  }

}

// 把文件切片合并成一个文件流
const pipStream = (chunkPath, stream) => {
  return new Promise((resolve, reject) => {
    // 创建可读流
    const readStream = fse.createReadStream(chunkPath)
    readStream.on('error', (error) => {
      reject(error)
    })
    // 在一个指定位置写入文件流
    readStream.pipe(stream).on('finish', () => {
      // 写入完成后，删除原切片文件
      fse.unlinkSync(chunkPath)
      resolve()
    })
  })
}

const createUploadedList = async (fileHash) => {
  return fse.existsSync(getChunkDir(fileHash)) ? fse.readdirSync(getChunkDir(fileHash)) : []
}