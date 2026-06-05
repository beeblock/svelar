# Storage

Manage file storage across local filesystem and S3-compatible object storage (RustFS, AWS S3, and other S3-compatible providers).

### Configuration

```typescript
import { Storage } from '@beeblock/svelar/storage';

Storage.configure({
  default: 'local',
  disks: {
    local: {
      driver: 'local',
      root: './storage/uploads',
    },
    s3: {
      driver: 's3',
      bucket: process.env.S3_BUCKET ?? 'svelar',
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'svelar',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'svelarsecret',
      forcePathStyle: true,  // Required for RustFS and most S3-compatible services
    },
  },
});
```

### Using Storage

```typescript
import { Storage } from '@beeblock/svelar/storage';

const disk = Storage.disk('local');

// Store file
await disk.put('avatars/user1.jpg', fileBuffer);

// Get file
const file = await disk.get('avatars/user1.jpg');

// Delete file
await disk.delete('avatars/user1.jpg');

// Check existence
const exists = await disk.exists('avatars/user1.jpg');

// List files
const files = await disk.files('avatars/');

// Get public URL
const url = disk.url('avatars/user1.jpg');
```

Missing files and missing directories use normal storage semantics: `exists()` returns `false`, `delete()` returns `false`, and listing methods return `[]`. Filesystem, S3 auth, bucket, network, and malformed path errors are not swallowed.

### S3 / RustFS Object Storage

Svelar includes a full S3-compatible storage driver that works with [RustFS](https://github.com/rustfs/rustfs), AWS S3, and other S3-compatible services. RustFS is included by default in `docker-compose` when you run `npx svelar make:docker`.

```bash
# Install the S3 SDK (peer dependency)
npm install @aws-sdk/client-s3

# Optional: for pre-signed temporary URLs
npm install @aws-sdk/s3-request-presigner
```

S3 disks support all the same methods as local disks, plus additional features:

```typescript
// Ensure bucket exists (auto-creates if missing for RustFS)
await Storage.s3Disk('s3').ensureBucket();

// Generate a pre-signed temporary URL (expires in 1 hour)
const tempUrl = await Storage.s3Disk('s3').temporaryUrl('invoices/001.pdf', 3600);

// Switch default disk to S3 for cloud-first deployments
Storage.configure({ default: 's3', disks: { ... } });
```

In Docker, RustFS runs on port 9000 (S3 API) and 9001 (web console). The app service gets `S3_ENDPOINT=http://rustfs:9000` and `STORAGE_DISK=s3` automatically.

> **RustFS Web Console**: Access at `http://localhost:9001` to browse buckets, upload files, and manage storage visually.
