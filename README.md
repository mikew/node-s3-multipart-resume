# s3-multipart-resume

Multipart uploads to S3 that you can resume.

## Installation

```bash
npm install --save s3-multipart-resume
```

## Usage

```js
import * as AWS from 'aws'
import { S3Uploader } from 's3-multipart-resume'

// Create the S3 instance however you would.
const s3Instance = new AWS.S3({})

const uploader = new S3Uploader({
  client: s3Instance,
  file: '/path/to/file',
  Bucket: 'MyBucket',
  Key: 'file',

  // Will pick up from where it left off if given `uploadId` and `parts`.
  // uploadId: null,
  // parts: [],

  onProgress (progress) {
    console.log(`${progress.percentComplete}% ; ETA: ${progress.eta} ; SPEED: ${progress.bytesPerSecond}B/s`)

    // You'll want to persist `uploader.options.parts` and
    // `uploader.options.uploadId` if you want to resume the upload.
  }
})

uploader.upload()
  .then(console.log)
  .catch(console.error)
```

## Cancelling

Set `uploader.isCancelled` to `true`.

```js
u.upload()

setTimeout(() => {
  uploader.isCancelled = true
}, 40000)
```

## Available options

```ts
interface S3UploaderOptions {
  file: string
  client: aws.S3
  Bucket: string
  Key: string

  onProgress?: S3UploaderProgressCallback

  parts?: S3UploaderPart[]
  uploadId?: string

  minPartSize?: number
  maxPartRetries?: number
  concurrent?: number
}
```