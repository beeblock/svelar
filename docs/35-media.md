# Media Library Plugin

A full-featured media library plugin for Svelar/SvelteKit with file uploads, image conversions, collections, disk storage (local or S3), and pre-built UI components for uploading, previewing, and browsing media.

**Package:** `@beeblock/svelar-media`

**Install:**

```bash
npm install @beeblock/svelar-media
```

**Imports:**

```ts
// Plugin registration
import { SvelarMediaPlugin } from '@beeblock/svelar-media/server';

// Core API
import { Media, MediaService, MediaCollection, HasMedia } from '@beeblock/svelar-media';

// Conversions
import { ConversionBuilder, ConversionWorker, ImageConverter } from '@beeblock/svelar-media/conversions';

// Server-side (controllers, validation)
import { MediaController, MediaRequest } from '@beeblock/svelar-media/server';

// UI components
import { MediaUploader, MediaGallery, MediaPreview } from '@beeblock/svelar-media/ui';

// Types
import type { MediaRecord, MediaCollectionConfig, ConversionDefinition, DiskType, CustomProperties } from '@beeblock/svelar-media';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarMediaPlugin } from '@beeblock/svelar-media/server';

export const mediaPlugin = new SvelarMediaPlugin({
  disk: 'local',
  storagePath: 'storage/media',
  maxFileSize: 10, // MB
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  conversions: true,
  prefix: '/api',
});
```

### 2. Add Media to a Model

```ts
import { Model } from '@beeblock/svelar/database';
import { HasMedia } from '@beeblock/svelar-media';

class Post extends HasMedia(Model) {
  static table = 'posts';

  registerMediaCollections() {
    this.addMediaCollection('images')
      .acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp'])
      .maxFileSize(5);

    this.addMediaCollection('documents')
      .acceptsMimeTypes(['application/pdf'])
      .singleFile();
  }

  registerMediaConversions() {
    this.addMediaConversion('thumb')
      .width(200)
      .height(200)
      .sharpen()
      .performOnCollections('images');

    this.addMediaConversion('preview')
      .width(800)
      .nonQueued();
  }
}
```

### 3. Upload Media

```ts
// In a server route or controller
const post = await Post.find(1);

// From a File object
await post.addMedia(file)
  .usingName('hero-image')
  .usingFileName('hero.jpg')
  .withCustomProperties({ alt: 'Hero image' })
  .toMediaCollection('images');

// From a URL
await post.addMediaFromUrl('https://example.com/photo.jpg')
  .usingName('external-photo')
  .toMediaCollection('images');
```

---

## Configuration

The `SvelarMediaPlugin` constructor accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `disk` | `'local' \| 's3'` | `'local'` | Default storage disk |
| `storagePath` | `string` | `'storage/media'` | Local storage path |
| `maxFileSize` | `number` | `10` | Max file size in MB |
| `allowedMimeTypes` | `string[]` | `['image/*', 'application/pdf']` | Allowed MIME types |
| `conversions` | `boolean` | `true` | Enable image conversions |
| `prefix` | `string` | `'/api'` | API route prefix |
| `s3` | `S3Config` | `undefined` | S3 configuration (bucket, region, etc.) |

---

## Core API

### HasMedia Mixin

The `HasMedia` mixin adds media management methods to any Svelar Model:

```ts
class Product extends HasMedia(Model) {
  static table = 'products';
}
```

**Instance methods:**

| Method | Returns | Description |
|---|---|---|
| `addMediaCollection(name)` | `MediaCollection` | Register a named media collection |
| `addMediaConversion(name)` | `ConversionBuilder` | Register a named image conversion |
| `addMedia(file)` | `MediaAdder` | Start adding a File/Buffer/ArrayBuffer |
| `addMediaFromUrl(url)` | `MediaUrlAdder` | Start adding media from a URL |
| `getMedia(collection?)` | `Promise<Media[]>` | Get all media, optionally filtered by collection |
| `getFirstMedia(collection?)` | `Promise<Media \| null>` | Get the first media item in a collection |
| `getFirstMediaUrl(collection?, conversion?)` | `Promise<string>` | Get URL of the first media item |
| `clearMediaCollection(collection)` | `Promise<void>` | Remove all media from a collection |
| `getMediaCount(collection?)` | `Promise<number>` | Count media items |

### MediaAdder (Fluent Builder)

Returned by `model.addMedia(file)`:

```ts
await post.addMedia(file)
  .usingName('my-photo')
  .usingFileName('photo.jpg')
  .withMimeType('image/jpeg')
  .withCustomProperties({ caption: 'A beautiful sunset' })
  .storingOn('s3')
  .withOrder(1)
  .toMediaCollection('images');
```

| Method | Description |
|---|---|
| `.usingName(name)` | Set the media name |
| `.usingFileName(fileName)` | Set the file name |
| `.withMimeType(mimeType)` | Set the MIME type |
| `.withCustomProperties(props)` | Attach custom key-value metadata |
| `.storingOn(disk)` | Choose the storage disk (`'local'` or `'s3'`) |
| `.withOrder(order)` | Set the display order |
| `.toMediaCollection(collection)` | Save to a named collection (required, finalizes the upload) |

### MediaUrlAdder

Returned by `model.addMediaFromUrl(url)`:

```ts
await post.addMediaFromUrl('https://cdn.example.com/photo.jpg')
  .usingName('cdn-photo')
  .toMediaCollection('images');
```

Same fluent methods as `MediaAdder`.

### MediaCollection

Configure collection constraints:

```ts
this.addMediaCollection('avatar')
  .singleFile()                                    // Only one file allowed
  .acceptsMimeTypes(['image/jpeg', 'image/png'])   // Restrict MIME types
  .maxFileSize(2)                                  // Max size in MB
  .useDisk('local');                               // Default disk for this collection
```

### Media Class

Represents a stored media item:

```ts
const media = await post.getFirstMedia('images');

media.id;                // number
media.name;              // string
media.fileName;          // string
media.mimeType;          // string
media.size;              // number (bytes)
media.collection;        // string
media.disk;              // 'local' | 's3'
media.customProperties;  // Record<string, unknown>
media.orderColumn;       // number
media.getUrl();          // Full URL to the original file
media.getUrl('thumb');   // Full URL to a conversion
media.getPath();         // File system path
media.toJSON();          // Serializable object
```

### MediaService

Low-level service for direct media operations:

```ts
import { MediaService } from '@beeblock/svelar-media';

const service = new MediaService(config);

await service.store(file, modelType, modelId, collection, options);
await service.delete(mediaId);
await service.getForModel(modelType, modelId, collection);
```

---

## Image Conversions

### ConversionBuilder

Define conversions with a fluent API:

```ts
this.addMediaConversion('thumb')
  .width(200)
  .height(200)
  .sharpen()
  .quality(80)
  .format('webp')
  .nonQueued()                     // Process immediately (not via queue)
  .performOnCollections('images'); // Only apply to specific collections
```

| Method | Description |
|---|---|
| `.width(px)` | Set output width |
| `.height(px)` | Set output height |
| `.quality(n)` | Set compression quality (1-100) |
| `.format(fmt)` | Convert to format (`'webp'`, `'png'`, `'jpeg'`) |
| `.sharpen()` | Apply sharpening |
| `.nonQueued()` | Process synchronously instead of via queue |
| `.performOnCollections(...names)` | Restrict to specific collections |

### ImageConverter

Performs the actual image transformation using Sharp:

```ts
import { ImageConverter } from '@beeblock/svelar-media/conversions';

const converter = new ImageConverter();
const outputBuffer = await converter.convert(inputBuffer, {
  width: 200,
  height: 200,
  quality: 80,
  format: 'webp',
  sharpen: true,
});
```

### ConversionWorker

Processes conversion jobs (used internally or via the scheduler):

```ts
import { ConversionWorker } from '@beeblock/svelar-media/conversions';

const worker = new ConversionWorker(config);
await worker.processMedia(mediaId);
```

---

## Server-Side

### MediaController

Handles media upload, retrieval, and deletion API routes:

```ts
// src/routes/api/media/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';

const controller = new MediaController(mediaPluginConfig);

export const GET = async (event) => controller.index(event);
export const POST = async (event) => controller.store(event);
```

```ts
// src/routes/api/media/[id]/+server.ts
export const GET = async (event) => controller.show(event);
export const DELETE = async (event) => controller.destroy(event);
```

### MediaRequest

Validates and parses incoming media upload requests:

```ts
import { MediaRequest } from '@beeblock/svelar-media/server';

const parsed = await MediaRequest.parse(event.request);
// parsed.file, parsed.collection, parsed.modelType, parsed.modelId, etc.
```

---

## UI Components

### MediaUploader

Drag-and-drop file uploader with progress:

```svelte
<script lang="ts">
  import { MediaUploader } from '@beeblock/svelar-media/ui';

  function handleUpload(media: any) {
    console.log('Uploaded:', media);
  }
</script>

<MediaUploader
  collection="images"
  modelType="posts"
  modelId={1}
  accept="image/*"
  multiple={true}
  maxFiles={5}
  maxSize={5}
  onUpload={handleUpload}
/>
```

### MediaGallery

Display a grid of media items with preview and actions:

```svelte
<script lang="ts">
  import { MediaGallery } from '@beeblock/svelar-media/ui';

  let media = $state([]);
</script>

<MediaGallery
  items={media}
  columns={3}
  selectable={true}
  onSelect={(item) => console.log('Selected:', item)}
  onDelete={(item) => console.log('Delete:', item)}
/>
```

### MediaPreview

Single media item preview (image, PDF, etc.):

```svelte
<script lang="ts">
  import { MediaPreview } from '@beeblock/svelar-media/ui';
</script>

<MediaPreview
  media={mediaItem}
  conversion="thumb"
  width={200}
  height={200}
/>
```

---

## Migration SQL

Run this migration to create the required `media` table:

```sql
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_type TEXT NOT NULL,
  model_id INTEGER NOT NULL,
  collection TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  disk TEXT NOT NULL DEFAULT 'local',
  size INTEGER DEFAULT 0,
  custom_properties TEXT DEFAULT '{}',
  order_column INTEGER DEFAULT 0,
  conversions TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_model ON media(model_type, model_id);
CREATE INDEX IF NOT EXISTS idx_media_collection ON media(model_type, model_id, collection);
```

---

## Full Working Example

```svelte
<!-- src/routes/posts/[id]/media/+page.svelte -->
<script lang="ts">
  import { MediaUploader, MediaGallery } from '@beeblock/svelar-media/ui';
  import { apiFetch } from '@beeblock/svelar/http';

  interface Props {
    data: { post: any; media: any[] };
  }
  let { data }: Props = $props();
  let media = $state(data.media);

  async function handleUpload(newMedia: any) {
    media = [...media, newMedia];
  }

  async function handleDelete(item: any) {
    await apiFetch(`/api/media/${item.id}`, { method: 'DELETE' });
    media = media.filter((m) => m.id !== item.id);
  }
</script>

<h1>Post Media</h1>

<MediaUploader
  collection="images"
  modelType="posts"
  modelId={data.post.id}
  accept="image/*"
  multiple={true}
  onUpload={handleUpload}
/>

<MediaGallery
  items={media}
  columns={4}
  onDelete={handleDelete}
/>
```

```ts
// src/routes/api/media/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';

const controller = new MediaController();

export const GET = async (event) => controller.index(event);
export const POST = async (event) => controller.store(event);
```

```ts
// src/routes/api/media/[id]/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';

const controller = new MediaController();

export const GET = async (event) => controller.show(event);
export const DELETE = async (event) => controller.destroy(event);
```
