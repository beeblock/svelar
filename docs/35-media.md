# Media Library Plugin

A media library plugin for Svelar/SvelteKit with file uploads, image conversions, collections, named Svelar storage disks (local or S3), and UI components for uploading, previewing, and browsing media.

**Package:** `@beeblock/svelar-media`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-media
```

**Imports:**

```ts
// Plugin registration
import SvelarMediaPlugin from '@beeblock/svelar-media/plugin';

// Server-side ORM/service API
import { Media, MediaService, MediaCollection, HasMedia } from '@beeblock/svelar-media';

// Conversions
import { ConversionBuilder, ConversionWorker, ImageConverter } from '@beeblock/svelar-media/conversions';

// Server-side (controllers, validation)
import { MediaController, MediaResource, MediaUploadRequest, parseMediaUpload, validateMediaUpload } from '@beeblock/svelar-media/server';

// UI components
import { MediaUploader, MediaGallery, MediaPreview } from '@beeblock/svelar-media/ui';

// Types
import type { MediaRecord, MediaModelId, MediaCollectionConfig, ConversionDefinition, DiskType, CustomProperties } from '@beeblock/svelar-media/types';
```

Use `/ui` for Svelte components and type-only imports from `/types` in browser code. The root ORM/service API, `/plugin`, and HTTP/controller exports are server-side APIs.

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import SvelarMediaPlugin from '@beeblock/svelar-media/plugin';
import { Storage } from '@beeblock/svelar/storage';
import { env } from '@beeblock/svelar/config';

// Include this disk in the application's central Storage configuration.
Storage.configure({
  default: 'local',
  disks: {
    local: { driver: 'local', root: env('MEDIA_STORAGE_ROOT', 'storage') },
  },
});

export const mediaPlugin = new SvelarMediaPlugin({
  disk: 'local',
  basePath: 'media',
  baseUrl: env('MEDIA_BASE_URL', '/storage/media'),
  maxUploadSize: 10 * 1024 * 1024, // bytes
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  allowedRemoteOrigins: ['https://example.com', 'https://cdn.example.com'],
  prefix: '/api',
});
```

Register `mediaPlugin` in the application's common plugin bootstrap. Its `register()` method configures the shared `MediaService` and binds the service as `media` in the container. Keep existing disks when adding media storage to an application. The default `/plugin` export is the registration entry; `/server` also provides a named `SvelarMediaPlugin` export. Service configuration is shared across the public server entries.

`basePath` is a key prefix within the configured disk. `baseUrl` must point to a browser-safe file-serving location supplied by the application; the plugin does not mount a file server. Private previews and downloads need an authorized application endpoint. S3 disks can be configured through Svelar `Storage`; the plugin's `s3` option also supports a dedicated S3 disk when `disk` is `'s3'`.

### 2. Add Media to a Model

```ts
import { Model } from '@beeblock/svelar/orm';
import { HasMedia } from '@beeblock/svelar-media';

class Post extends HasMedia(Model) {
  static table = 'posts';

  registerMediaCollections() {
    this.addMediaCollection('images')
      .acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp'])
      .maxFileSize(5 * 1024 * 1024);

    this.addMediaCollection('documents')
      .acceptsMimeTypes(['application/pdf'])
      .singleFile();
  }

  registerMediaConversions() {
    this.addMediaConversion('thumb')
      .width(200)
      .height(200)
      .crop('center')
      .performOnCollections('images');

    this.addMediaConversion('preview')
      .width(800)
      .nonQueued();
  }
}
```

### 3. Upload Media

```ts
// In an authorized application action/service
const post = await Post.findOrFail(1);

// From a File object
await post.addMedia(file)
  .usingName('hero-image')
  .usingFileName('hero.jpg')
  .withCustomProperties({ alt: 'Hero image' })
  .toCollection('images')
  .save();

// From a URL
await post.addMediaFromUrl('https://example.com/photo.jpg')
  .usingName('external-photo')
  .toCollection('images')
  .save();
```

URL imports require an explicitly allowlisted HTTPS origin in `allowedRemoteOrigins`; the default empty list denies remote imports. Redirects are rejected, downloads are bounded by `maxUploadSize`, and `remoteTimeoutMs` controls the request timeout.

---

## Configuration

The `SvelarMediaPlugin` constructor accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `disk` | `string` | `'local'` | Named Svelar storage disk |
| `basePath` | `string` | `'media'` | Key prefix within the disk |
| `baseUrl` | `string` | `'/storage/media'` | Application-provided browser URL prefix |
| `maxUploadSize` | `number` | `10 * 1024 * 1024` | Maximum file size in bytes |
| `allowedMimeTypes` | `string[]` | Concrete MIME allowlist below | Exact MIME matches; wildcard entries are not expanded |
| `connection` | `string` | `undefined` | Named Svelar database connection; omitted uses the current/default connection |
| `allowedRemoteOrigins` | `string[]` | `[]` | Trusted HTTPS origins for URL imports |
| `remoteTimeoutMs` | `number` | `10000` | Remote request timeout in milliseconds |
| `prefix` | `string` | `'/api'` | Retained configuration value; published routes remain under `/api/media` |
| `s3` | `S3Config` | `undefined` | S3 configuration (bucket, region, etc.) |

The default MIME allowlist is `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif`, `application/pdf`, `video/mp4`, `video/webm`, `audio/mpeg`, `audio/ogg`, `application/zip`, `text/plain`, and `text/csv`. Model collection limits and per-request rules can further restrict uploads. Image conversions require the optional `sharp` package and registered conversion definitions.

---

## Core API

### HasMedia Mixin

The `HasMedia` mixin adds media management methods to any Svelar Model:

```ts
class Product extends HasMedia(Model) {
  static table = 'products';
}
```

The trait reads the model's declared `static primaryKey` through `getAttribute()`. Integer, UUID, ULID, and custom string primary keys are supported. Persist the owner before attaching media; a missing primary key fails validation.

Model target inputs use `MediaModelId = string | number`. Safe integer numbers become their decimal string representation; nonempty string keys of up to 255 characters retain their exact spelling, including case, leading zeroes, and trailing spaces. NUL characters are rejected. The media table stores `model_id` as `VARCHAR(255)`, and `media.modelId`, `MediaRecord.model_id`, resource responses, and host authorization targets use canonical strings. Media row IDs remain positive numeric IDs. Both `model_type` and `model_id` identify the owner exactly; MySQL queries include binary predicates to preserve that identity under case-insensitive collations. Storage paths hash the canonical model ID into a safe directory segment.

For example, an owner model with a generated UUID primary key can declare:

```ts
class Asset extends HasMedia(Model) {
  static table = 'assets';
  static primaryKey = 'asset_key';
  static incrementing = false;
  static uniqueIds = ['asset_key'];
  static uniqueIdType = 'uuid' as const;
}
```

Its application migration must provide the matching primary/unique key. Use `uniqueIdType = 'ulid'` for generated ULIDs, or provide a persisted custom key yourself. Authorizers should compare canonical strings, such as `target.modelId === String(asset.getAttribute(Asset.primaryKey))`.

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
  .toDisk('s3')
  .withOrder(1)
  .toCollection('images')
  .save();
```

| Method | Description |
|---|---|
| `.usingName(name)` | Set the media name |
| `.usingFileName(fileName)` | Set the preferred file name; storage sanitizes it and chooses an extension from the MIME type |
| `.withMimeType(mimeType)` | Set the MIME type |
| `.withCustomProperties(props)` | Attach custom key-value metadata |
| `.toDisk(disk)` | Choose a named storage disk |
| `.withOrder(order)` | Set the display order |
| `.toCollection(collection)` | Choose a named collection; defaults to `'default'` |
| `.save()` | Validate, store, and return the media item |

### MediaUrlAdder

Returned by `model.addMediaFromUrl(url)`:

```ts
await post.addMediaFromUrl('https://cdn.example.com/photo.jpg')
  .usingName('cdn-photo')
  .toCollection('images')
  .save();
```

Supports `.usingName()`, `.withCustomProperties()`, `.toDisk()`, `.withOrder()`, `.toCollection()`, and `.save()`. File name and MIME type come from the trusted download.

### MediaCollection

Configure collection constraints:

```ts
this.addMediaCollection('avatar')
  .singleFile()                                    // Only one file allowed
  .acceptsMimeTypes(['image/jpeg', 'image/png'])   // Restrict MIME types
  .maxFileSize(2 * 1024 * 1024);                    // Max size in bytes
```

Use `.maxFiles(count)` for a collection limit and `.toDisk(name)` on the media adder to select its disk. A single-file upload stores the replacement before removing the previously loaded item; this sequence does not provide an atomic collection limit across concurrent uploads.

### Media Class

Extends the Svelar ORM `Model` and represents a stored media item:

```ts
const media = await post.getFirstMedia('images');

media.id;                // number
media.modelId;           // canonical string owner identifier
media.name;              // string
media.fileName;          // string
media.mimeType;          // string
media.size;              // number (bytes)
media.collection;        // string
media.disk;              // named disk (string)
media.customProperties;  // Record<string, unknown>
media.orderColumn;       // number
media.getUrl();          // Full URL to the original file
media.getUrl('thumb');   // Full URL to a conversion
media.getPath();         // Stored relative key (without basePath)
media.toJSON();          // Serializable object
```

Use `media.delete()`, `media.move(collection)`, and `media.setCustomProperty(key, value)` for its supported mutations. Authorize trusted service calls in the application. `MediaResource` provides browser-facing JSON with parsed custom properties and conversion URLs while omitting storage paths and disk names; the model's `toJSON()`/`toRecord()` expose its stored record.

### MediaService

Low-level service for direct media operations:

```ts
import { MediaService } from '@beeblock/svelar-media';

const service = MediaService.instance(); // configured by plugin registration

const media = await service.store({
  modelType: 'posts',
  modelId: post.getAttribute(Post.primaryKey),
  collection: 'images',
  file: buffer,
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: buffer.length,
});
await service.getMedia('posts', post.getAttribute(Post.primaryKey), 'images');
await service.getMediaById(media.id);
await service.deleteMedia(media);
```

`MediaService.configure(options)` is an alternative for applications configuring the service directly. Use the `connection` name to select a core-managed database connection. The service persists through ORM models/repositories and uses the configured disk for originals, conversions, and deletion; direct service calls do not apply HTTP authorization. File storage and database writes are separate operations, so application workflows must account for partial failures.

---

## Image Conversions

### ConversionBuilder

Define conversions with a fluent API:

```ts
this.addMediaConversion('thumb')
  .width(200)
  .height(200)
  .crop('center')
  .quality(80)
  .format('webp')
  .nonQueued()                     // Compatibility flag; processing is currently inline
  .performOnCollections('images'); // Only apply to specific collections
```

| Method | Description |
|---|---|
| `.width(px)` | Set output width |
| `.height(px)` | Set output height |
| `.quality(n)` | Set compression quality (1-100) |
| `.format(fmt)` | Convert to format (`'webp'`, `'png'`, `'jpeg'`) |
| `.crop(position)` | Use a crop position such as `'center'`, `'top'`, or `'bottom-right'` |
| `.nonQueued()` / `.queued()` | Compatibility flags; neither dispatches a queue job |
| `.performOnCollections(...names)` | Restrict to specific collections |

### ImageConverter

Performs the actual image transformation using Sharp:

```ts
import { ConversionBuilder, ImageConverter } from '@beeblock/svelar-media/conversions';

const converter = await ImageConverter.create();
const definition = new ConversionBuilder('thumb')
  .width(200).height(200).crop('center').quality(80).format('webp').build();
const converted = await converter.convert(inputBuffer, definition);
const outputBuffer = converted.buffer;
```

### ConversionWorker

Processes registered conversions through the media item's storage disk:

```ts
import { ConversionWorker } from '@beeblock/svelar-media/conversions';

const definitions = post.getRegisteredConversions();
await ConversionWorker.processConversions(media, definitions);
await ConversionWorker.regenerateConversions(media, definitions);
await ConversionWorker.processBatch(mediaItems, definitions);
```

The automatic conversion path is inline and best-effort: missing Sharp, unreadable originals, or individual conversion failures can leave an original without a conversion. `media.hasConversion(name)` reports what was generated. Durable background conversion work requires an application-owned Svelar queue job.

---

## Server-Side

### MediaController

Handles media upload, retrieval, and deletion API routes:

Configure Svelar authentication so `event.locals.user` is trusted request-local state. Register an application-owned resolver in the common server bootstrap before binding routes:

```ts
import { MediaController } from '@beeblock/svelar-media/server';
import { authorizeMediaTarget } from '$lib/shared/media-access.server';

MediaController.configure({ authorize: authorizeMediaTarget });
```

`authorizeMediaTarget` is an application function with the `MediaAuthorizer` signature `(event, operation, target) => boolean | Promise<boolean>`. It must check the operation's registered capability and the persisted owner's policy/tenant access. Register literal capabilities and synchronize their catalogs/profiles in application seeders as described in the [permissions guide](./49-permissions.md). Resolve `target.modelType` through a trusted allowlist and compare `target.modelId` as a canonical string.

The controller fails closed: anonymous requests return `401`; a missing resolver or a denied target returns `403`. Generic endpoints also reject Bearer/API-key/Authorization-header requests; supplying the host resolver does not enable a credential-ceiling-aware token route. Mutations retain Svelar origin and CSRF middleware checks, including the default `X-CSRF-Token` header and `XSRF-TOKEN` cookie.

```ts
// src/routes/api/media/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => MediaController.index(event);
export const POST: RequestHandler = (event) => MediaController.upload(event);
```

```ts
// src/routes/api/media/[id]/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => MediaController.show(event);
export const DELETE: RequestHandler = (event) => MediaController.destroy(event);
```

`index` reads `model_type`, `model_id`, and optional `collection` query parameters. The item methods accept the numeric `params.id` or an `id` query parameter. Additional static handlers are `reorder`, `updateProperties`, and `clearCollection`; reordering authorizes every numeric media row ID and restricts the request to one owner/collection. Resource success responses use `{ success: true, data }`; validation failures return `422` with validation details where available.

### MediaRequest

Use the public parsing helpers or the exported FormRequest classes; there is no exported `MediaRequest` class:

```ts
import { parseMediaUpload, validateMediaUpload } from '@beeblock/svelar-media/server';

// Called within an already authorized application write flow.
const parsed = await parseMediaUpload(event.request);
validateMediaUpload(parsed, { maxSize: 5 * 1024 * 1024 });
// parsed.file, parsed.collection, parsed.modelType, parsed.modelId, etc.
```

The upload is multipart form data with `file`, `model_type`, and `model_id`; optional fields are `collection`, `name`, and JSON-object `custom_properties`. `MediaUploadRequest`, `MediaDeleteRequest`, `MediaReorderRequest`, `MediaPropertiesRequest`, and `MediaClearRequest` validate shared exported schemas and produce DTOs for the controller's action/service flow. Parsing helpers alone do not authorize a target.

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
  uploadUrl="/api/media"
  collection="images"
  modelType="posts"
  modelId={1}
  accept="image/*"
  multiple={true}
  maxFiles={5}
  maxFileSize={5 * 1024 * 1024}
  onUploadComplete={handleUpload}
/>
```

`modelId` accepts a string or number. The uploader uses same-origin URLs, reads the default CSRF cookie unless `csrfToken` is supplied, and passes the response's `data` item to `onUploadComplete`. Client `accept`, `maxFiles`, and `maxFileSize` checks supplement server rules.

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
  deletable={true}
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
  item={mediaItem}
  aspectRatio="1"
/>
```

---

## Migration SQL

Publish and run the actual Svelar migration for the `media` table:

```bash
npx svelar plugin:publish @beeblock/svelar-media
npx svelar migrate
```

The published file is `src/lib/database/migrations/create_media_table.ts`, a `Migration` subclass using the Svelar schema builder. It creates the numeric media row key, `model_type VARCHAR(100)`, `model_id VARCHAR(255)`, the stored `path`, metadata fields, timestamps, and owner/collection indexes. The service supplies JSON text values for `custom_properties` and `conversions`; the portable migration does not use MySQL-incompatible literal defaults on TEXT columns. Table creation belongs in migrations, never application bootstrap or request handlers. `MEDIA_MIGRATION_SQL` remains a legacy SQLite-specific export; it is not the portable migration or an automatic runtime installer.

This is an alpha plugin schema. Adjust an unpublished migration before its first run if needed. If an application has already run an older integer-`model_id` migration, publishing a new template does not upgrade that database. Generate a focused application migration, preserve existing records and stored paths, convert owner IDs to canonical strings, and retain the numeric media row key and indexes:

```bash
npx svelar make:migration migrate_media_model_identifiers
```

Review the database-specific conversion against existing data before applying it; keep UTF-8 storage and exact owner type/ID comparisons. Do not drop the table or rerun its create migration to upgrade an existing application.

---

## Full Working Example

The page's authorized server load should supply serialized `MediaResource` items as `data.media`. These routes rely on the storage, authentication, and application capability/policy resolver configured above.

```svelte
<!-- src/routes/posts/[id]/media/+page.svelte -->
<script lang="ts">
  import { MediaUploader, MediaGallery } from '@beeblock/svelar-media/ui';
  import { apiFetch } from '@beeblock/svelar/http';

  interface Props {
    data: { post: any; media: any[] };
  }
  let { data }: Props = $props();
  let media = $state<any[]>([]);
  $effect(() => { media = data.media; });

  async function handleUpload(newMedia: any) {
    media = [...media, newMedia];
  }

  async function handleDelete(item: any) {
    const response = await apiFetch(`/api/media/${item.id}`, { method: 'DELETE' });
    if (response.ok) media = media.filter((m) => m.id !== item.id);
  }
</script>

<h1>Post Media</h1>

<MediaUploader
  uploadUrl="/api/media"
  collection="images"
  modelType="posts"
  modelId={data.post.id}
  accept="image/*"
  multiple={true}
  onUploadComplete={handleUpload}
/>

<MediaGallery
  items={media}
  columns={4}
  deletable={true}
  onDelete={handleDelete}
/>
```

```ts
// src/routes/api/media/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';
import type { RequestHandler } from './$types';

// Application bootstrap has configured MediaController's capability/policy resolver.
export const GET: RequestHandler = (event) => MediaController.index(event);
export const POST: RequestHandler = (event) => MediaController.upload(event);
```

```ts
// src/routes/api/media/[id]/+server.ts
import { MediaController } from '@beeblock/svelar-media/server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => MediaController.show(event);
export const DELETE: RequestHandler = (event) => MediaController.destroy(event);
```
