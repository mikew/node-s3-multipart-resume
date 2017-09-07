import * as fs from 'fs'
import * as AWS from 'aws-sdk'

let stats: any = {}

try {
  stats = JSON.parse(fs.readFileSync('testupload.json', 'utf8'))
} catch (err) {
  console.error(err)
}

import { S3Uploader } from './index'

const timeout = undefined

const s3Instance = new AWS.S3({
  httpOptions: {
    connectTimeout: timeout,
    timeout: timeout,
  },
})

AWS.config.update({
  useAccelerateEndpoint: true,
  httpOptions: {
    connectTimeout: timeout,
    timeout: timeout,
  },
})

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_KEY,
}

AWS.config.update(credentials)
s3Instance.config.update(credentials)

const u = new S3Uploader({
  concurrent: 2,
  uploadId: stats.uploadId,
  parts: stats.parts || [],
  file: '/Users/mike/Downloads/e168bc0f-9efd-4633-9049-15f6d0f62ec7.zip',
  Key: 'TESTUPLOAD.zip',
  client: s3Instance,
  Bucket: 'sst-surveydata',
  onProgress (progress) {
    console.log(`onPing ${progress.percentComplete}% ; ETA: ${progress.eta} ; SPEED: ${progress.bytesPerSecond}B/s`)

    fs.writeFileSync('testupload.json', JSON.stringify({
      parts: u.options.parts,
      uploadId: u.options.uploadId,
    }), 'utf8')
  }
})

process.on('unhandledRejection', r => {
  console.error('UNHANDLED PROMISE REJECTION!!!')
  console.error(r)
})

// setTimeout(() => {
//   console.log('!!! canceling upload')
//   u.isCancelled = true
// }, 40000)

u.upload()
  .then(() => {
    console.log('YAYYYY')

    fs.writeFileSync('testupload.json', JSON.stringify({
      parts: u.options.parts,
      uploadId: u.options.uploadId,
    }), 'utf8')
  })
  .catch(console.error)