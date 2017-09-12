import * as fs from 'fs'
import * as path from 'path'
import * as aws from 'aws-sdk'
import {
  CompleteMultipartUploadOutput,
  UploadPartOutput,
  CompleteMultipartUploadRequest,
  UploadPartRequest,
} from 'aws-sdk/clients/s3'

const defaultOptions: Partial<S3UploaderOptions> = {
  minPartSize: 1024 * 1024 * 5,
  parts: [],
  concurrent: 3,
  maxPartRetries: 3,
  onProgress: () => {},
}

export class S3Uploader {
  numParts: number = 0
  startedAt?: Date
  isCancelled: boolean = false
  partsFinishedInSession: number = 0
  fileSize?: number
  availableIndexes: number[] = []
  options: S3UploaderOptions = {} as S3UploaderOptions
  lastProgress: S3UploaderProgress = {} as S3UploaderProgress

  /**
   * Creates an instance of S3Uploader.
   *
   * @param {S3UploaderOptions} options
   * @memberof S3Uploader
   */
  constructor (options: S3UploaderOptions) {
    this.options = {
      ...defaultOptions,
      ...options,
    }

    if (this.options.Key == null) {
      this.options.Key = path.basename(this.options.file)
    }
  }

  /**
   * The public upload method.
   * Recalculate numParts / fileSize / availableIndexes.
   *
   * @returns {Promise<S3Uploader>}
   * @memberof S3Uploader
   */
  upload (): Promise<S3Uploader> {
    this.partsFinishedInSession = 0
    this.isCancelled = false
    this.startedAt = new Date()

    return fsStatPromise(this.options.file)
      .then(stats => {
        const size = stats.size

        this.numParts = Math.ceil(size / this.options.minPartSize!)
        this.fileSize = size

        const indexesAlreadyUploaded = this.options.parts!.map(x => x.PartNumber - 1)
        this.availableIndexes = []

        for (let i = 0; i < this.numParts; i++) {
          if (indexesAlreadyUploaded.indexOf(i) === -1) {
            this.availableIndexes.push(i)
          }
        }

        if (this.availableIndexes.length === 0) {
          return Promise.resolve(this)
        }

        return this.ensureUploadId()
          .then(() => {
            this.updatePercentComplete()
            this.options.onProgress!(this.lastProgress)
          })
          .then(this.startAllUploaders)
          .then(this.completeMultipartUpload)
          .then(() => this)
      })
  }

  /**
   * Ensure uploadId exists.
   *
   * @private
   * @memberof S3Uploader
   */
  private ensureUploadId = (): Promise<string> => {
    if (this.options.uploadId) {
      return Promise.resolve(this.options.uploadId)
    }

    const params = {
      Bucket: this.options.Bucket,
      Key: this.options.Key,
    }

    return this.options.client!.createMultipartUpload(params).promise()
      .then(x => {
        this.options.uploadId = x.UploadId

        return x.UploadId!
      })
  }

  /**
   * Start concurrent uploaders.
   *
   * @private
   * @memberof S3Uploader
   */
  private startAllUploaders = () => {
    const promises: Promise<any>[] = []

    for (let i = 0; i < this.options.concurrent!; i++) {
      promises.push(this.uploadNextPart())
    }

    return Promise.all(promises)
  }

  /**
   * Complete the multipart upload using the client.
   * Ensures parts are sorted by PartNumber.
   *
   * @private
   * @memberof S3Uploader
   */
  private completeMultipartUpload = (): Promise<CompleteMultipartUploadOutput> => {
    const sorted = this.options.parts!.concat()
      .sort((a, b) => a.PartNumber - b.PartNumber)

    const params: CompleteMultipartUploadRequest = {
      Bucket: this.options.Bucket,
      Key: this.options.Key,
      UploadId: this.options.uploadId!,
      MultipartUpload: { Parts: sorted },
    }

    return this.options.client!.completeMultipartUpload(params).promise()
  }

  /**
   * Recursively upload next part until there are no more availableIndexes.
   *
   * @private
   * @memberof S3Uploader
   */
  private uploadNextPart = (): Promise<UploadPartOutput | void> => {
    const index = this.availableIndexes.shift()

    if (index == null) {
      return Promise.resolve()
    }

    const start = this.options.minPartSize! * index
    const end = start + this.options.minPartSize! - 1

    return readStreamPromise(this.options.file, {
      prepareStream: this.options.prepareStream,
      start,
      end,
    })
      .then(buffer => this.attemptUploadPart(buffer, index, 1))
      .then(() => {
        this.updatePercentComplete()
        this.options.onProgress!(this.lastProgress)

        if (this.isCancelled) {
          return Promise.reject(new Error('Upload cancelled by user'))
        }

        return this.uploadNextPart()
      })
  }

  /**
   * Attempt upload of PartNumber using client.
   * Fails if maxPartRetries has been reached.
   *
   * @private
   * @memberof S3Uploader
   */
  private attemptUploadPart = (
    buffer: Buffer,
    index: number,
    attemptNumber: number
  ): Promise<UploadPartOutput> => {
    const params: UploadPartRequest = {
      Bucket: this.options.Bucket,
      Key: this.options.Key,
      PartNumber: index + 1,
      UploadId: this.options.uploadId!,
      Body: buffer,
    }

    return this.options.client!.uploadPart(params).promise()
      .then((data: UploadPartOutput) => {
        this.partsFinishedInSession++
        this.options.parts = this.options.parts!.concat({
          PartNumber: index + 1,
          ...data,
        })

        return data
      })
      .catch(err => {
        if (attemptNumber >= this.options.maxPartRetries!) {
          return Promise.reject(err)
        }

        return this.attemptUploadPart(buffer, index, attemptNumber + 1)
      })
  }

  /**
   * Recalculate eta / bytesPerSecond / etc.
   */
  private updatePercentComplete = () => {
    const now = new Date()

    const diff = (now.valueOf() - this.startedAt!.valueOf()) / 1000

    const bytesUploadedTotal = Math.min(
      this.options.parts!.length * this.options.minPartSize!,
      this.fileSize!
    )

    const bytesUploadedSession = Math.min(
      this.partsFinishedInSession * this.options.minPartSize!,
      this.fileSize!
    )
    const bytesPerSecond = bytesUploadedSession / diff
    const bytesRemaining = this.fileSize! - bytesUploadedTotal
    const secsRemaining = bytesRemaining / bytesPerSecond

    this.lastProgress.bytesPerSecond = bytesPerSecond
    this.lastProgress.eta = new Date(now.valueOf() + (secsRemaining * 1000))
    if (isNaN(this.lastProgress.eta.valueOf())) {
      this.lastProgress.eta = new Date(now.valueOf() + 60 * 60 * 1000)
    }
    this.lastProgress.percentComplete = bytesUploadedTotal / this.fileSize! * 100

    if (isNaN(this.lastProgress.percentComplete)) {
      this.lastProgress.percentComplete = 0
    }
  }
}

function defaultPrepareStream (stream: fs.ReadStream): fs.ReadStream {
  return stream
}

interface ReadStreamPromiseOptions {
  start: number
  end: number
  prepareStream?: (string: fs.ReadStream) => fs.ReadStream
}

/**
 * Reads a stream from start to end and resolves a chunk.
 *
 * @param {string} file
 * @param {ReadStreamPromiseOptions} [options={ start: 0, end: 1 }]
 * @returns {Promise<Buffer>}
 */
function readStreamPromise (
  file: string,
  options: ReadStreamPromiseOptions = { start: 0, end: 1 }
): Promise<Buffer> {
  const prepareStream = options.prepareStream || defaultPrepareStream

  return new Promise((resolve, reject) => {
    const stream = prepareStream(fs.createReadStream(file, options))
    let buffer = new Buffer([])

    stream.on('data', data => {
      buffer = Buffer.concat([ buffer, data ])
    })

    stream.on('end', () => resolve(buffer))
    stream.on('error', err => reject(err))
  })
}

/**
 * Promised fs.stat
 *
 * @param {string} file
 * @returns {Promise<fs.Stats>}
 */
function fsStatPromise (file: string): Promise<fs.Stats> {
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

export interface S3UploaderPart extends UploadPartOutput {
  PartNumber: number
}

export interface S3UploaderProgress {
  eta: Date
  bytesPerSecond: number
  percentComplete: number
}

export interface S3UploaderProgressCallback {
  (progress: S3UploaderProgress): any
}

export interface S3UploaderOptions {
  file: string
  client: aws.S3
  Bucket: string
  Key: string

  minPartSize?: number
  parts?: S3UploaderPart[]
  concurrent?: number
  maxPartRetries?: number

  uploadId?: string
  prepareStream?: (stream: fs.ReadStream) => fs.ReadStream
  onProgress?: S3UploaderProgressCallback
}