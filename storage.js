import { S3Client } from '@aws-sdk/client-s3';

const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} puuttuu ympäristömuuttujista.`);
  }
}

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

export const shareBucketName = process.env.SHARE_BUCKET_NAME;
export const humorBucketName = process.env.HUMOR_BUCKET_NAME;

if (!shareBucketName) {
  throw new Error('SHARE_BUCKET_NAME puuttuu ympäristömuuttujista.');
}

if (!humorBucketName) {
  throw new Error('HUMOR_BUCKET_NAME puuttuu ympäristömuuttujista.');
}
