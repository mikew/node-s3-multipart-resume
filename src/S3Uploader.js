import fs from 'fs'
import path from 'path'

export default class S3Uploader {
  file = null
  minPartSize = 1024 * 1024 * 5
  parts = []
  uploadId = null
  numParts = 0
  client = null
  startedAt = null
  concurrent = 3
  isCancelled = false
  partsFinishedInSession = 0

  upload = () => {
    this.partsFinishedInSession = 0
    this.isCancelled = false
    this.startedAt = new Date()

    if (this.Key == null) {
      this.Key = path.basename(this.file)
    }

    return fsStatPromise(this.file)
      .then(stats => {
        const size = stats.size

        this.numParts = Math.ceil(size / this.minPartSize)
        this.fileSize = size

        // Get available parts
        const indexesAlreadyUploaded = this.parts.map(x => x.PartNumber - 1)

        this.availableIndexes = []

        for (let i = 0; i < this.numParts; i++) {
          if (indexesAlreadyUploaded.indexOf(i) !== -1) {
            continue
          }

          this.availableIndexes.push(i)
        }

        if (this.availableIndexes.length === 0) {
          return Promise.resolve()
        }

        return this.ensureUploadId()
          .then(uploadId => {
            this.uploadId = uploadId
            const promises = []

            for (let i = 0; i < this.concurrent; i++) {
              promises.push(this.uploadPart())
            }

            return Promise.all(promises)
          })
          .then(() => this.completeMultipartUpload())
          .then(_ => this)
      })
  }

  completeMultipartUpload = () => {
    const sorted = this.parts.concat()
      .sort((a, b) => a.PartNumber - b.PartNumber)

    const params = {
      Bucket: this.Bucket,
      Key: this.Key,
      UploadId: this.uploadId,
      MultipartUpload: { Parts: sorted },
    }

    return new Promise((resolve, reject) => {
      this.client.completeMultipartUpload(params, (err, data) => {
        if (err) {
          reject(err)

          return
        }

        resolve(data)
      })
    })
  }

  ensureUploadId = () => {
    const params = {
      Bucket: this.Bucket,
      Key: this.Key,
    }

    return new Promise((resolve, reject) => {
      if (this.uploadId) {
        resolve(this.uploadId)

        return
      }

      this.client.createMultipartUpload(params, (err, data) => {
        if (err) {
          reject(err)

          return
        }

        resolve(data.UploadId)
      })
    })
  }

  uploadPart = () => {
    const index = this.availableIndexes.shift()

    if (index == null) {
      return Promise.resolve()
    }

    this.handlePing()

    const start = this.minPartSize * index
    const end = start + this.minPartSize - 1

    return readStreamPromise(this.file, {
      prepareStream: this.prepareStream,
      start,
      end,
    })
      .then(buffer => {
        const params = {
          Bucket: this.Bucket,
          Key: this.Key,
          PartNumber: index + 1,
          UploadId: this.uploadId,
          Body: buffer,
        }

        return new Promise((resolve, reject) => {
          this.client.uploadPart(params, (err, data) => {
            if (err) {
              reject(err)

              return
            }

            this.partsFinishedInSession++
            this.parts.push({
              PartNumber: index + 1,
              ...data,
            })

            resolve(data)
          })
        })
      })
      .then(() => {
        if (this.isCancelled) {
          this.handlePing()

          return Promise.reject(new Error('Upload cancelled by user'))
        }

        this.updatePercentComplete()

        return this.uploadPart()
      })
  }

  updatePercentComplete = () => {
    const now = new Date()
    const diff = (now - this.startedAt) / 1000

    const bytesUploaded = this.partsFinishedInSession * this.minPartSize
    const bytesPerSecond = bytesUploaded / diff

    const bytesRemaining = this.availableIndexes.length * this.minPartSize
    const secsRemaining = bytesRemaining / bytesPerSecond

    this.eta = new Date(now.getTime() + secsRemaining * 1000)
    this.percentComplete = bytesUploaded / this.fileSize
  }

  handlePing = () => {
    this.onPing(this)
  }
}

function defaultPrepareStream (stream) {
  return stream
}

function readStreamPromise (file, options = {}) {
  options.prepareStream = options.prepareStream || defaultPrepareStream

  return new Promise((resolve, reject) => {
    const stream = options.prepareStream(fs.createReadStream(file, options))
    let buffer = new Buffer([])

    stream.on('data', data => {
      buffer = Buffer.concat([ buffer, data ])
    })

    stream.on('end', () => resolve(buffer))
    stream.on('error', err => reject(err))
  })
}

function fsStatPromise (file) {
  return new Promise((resolve, reject) => {
    fs.stat(file, (err, stats) => {
      if (err) {
        reject(err)

        return
      }

      resolve(stats)
    })
  })
}
