import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const peers = vi.hoisted(() => ({
  createRequire: vi.fn(),
  load: vi.fn(),
  constructClient: vi.fn(),
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('node:module', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:module')>(),
  createRequire: peers.createRequire,
}));

class Command {
  constructor(readonly input: Record<string, unknown>) {}
}
class PutObjectCommand extends Command {}
class GetObjectCommand extends Command {}
class HeadBucketCommand extends Command {}
class Client {
  send = peers.send;
  constructor(config: Record<string, unknown>) {
    peers.constructClient(config);
  }
}

const clientSpecifier = '@aws-sdk/client-s3';
const presignerSpecifier = '@aws-sdk/s3-request-presigner';
const clientModule = { S3Client: Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand };
const presignerModule = { getSignedUrl: peers.getSignedUrl };
const config = {
  driver: 's3' as const,
  bucket: 'optional-peer-fixture',
  endpoint: 'https://storage.example.test',
  region: 'fixture-region',
  accessKeyId: 'fixture-access',
  secretAccessKey: 'fixture-secret',
  prefix: 'tenant-a',
};

function loadPeer(specifier: string) {
  if (specifier === clientSpecifier) return clientModule;
  if (specifier === presignerSpecifier) return presignerModule;
  throw new Error(`Unexpected optional peer: ${specifier}`);
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(peers)) mock.mockReset();
  peers.createRequire.mockReturnValue(peers.load);
  peers.load.mockImplementation(loadPeer);
  peers.send.mockResolvedValue({});
  peers.getSignedUrl.mockResolvedValue('https://storage.example.test/signed');
});

describe('Storage optional peer loading (controlled SDK seam, not native S3 certification)', () => {
  it('does not resolve optional peers on import, configuration, disk creation or synchronous URL reads', async () => {
    const { S3Disk, Storage } = await import('../src/storage/index.js');
    Storage.configure({ default: 'local', disks: { local: { driver: 'local', root: tmpdir(), urlPrefix: '/assets' } } });
    expect(Storage.url('report.txt')).toBe('/assets/report.txt');
    const disk = new S3Disk(config);
    expect(disk.url('report.txt')).toBe('https://storage.example.test/optional-peer-fixture/tenant-a/report.txt');
    expect(peers.createRequire).not.toHaveBeenCalled();
    expect(peers.load).not.toHaveBeenCalled();
    expect(peers.constructClient).not.toHaveBeenCalled();
  });

  it('loads the exact client SDK through a native module-relative require and caches the SDK and client', async () => {
    const { S3Disk } = await import('../src/storage/index.js');
    const disk = new S3Disk(config);
    const pending = disk.put('first.txt', 'first');
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    await disk.put('second.txt', Buffer.from('second'));
    await disk.ensureBucket();

    expect(peers.load.mock.calls).toEqual([[clientSpecifier]]);
    expect(peers.createRequire).toHaveBeenCalledTimes(1);
    expect(new URL(peers.createRequire.mock.calls[0][0]).pathname).toMatch(/\/src\/storage\/index\.ts$/);
    expect(peers.constructClient.mock.calls).toEqual([[{
      region: 'fixture-region', endpoint: 'https://storage.example.test', forcePathStyle: true,
      credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    }]]);
    const commands = peers.send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[0].input).toEqual({ Bucket: config.bucket, Key: 'tenant-a/first.txt', Body: Buffer.from('first') });
    expect(commands[1].input).toEqual({ Bucket: config.bucket, Key: 'tenant-a/second.txt', Body: Buffer.from('second') });
    expect(commands[2]).toBeInstanceOf(HeadBucketCommand);
    expect(commands[2].input).toEqual({ Bucket: config.bucket });
  });

  it('loads the presigner only for temporary URLs and signs with the same cached client and correct command/options', async () => {
    const { S3Disk } = await import('../src/storage/index.js');
    const disk = new S3Disk(config);
    await disk.put('report.txt', 'report');
    expect(peers.load.mock.calls).toEqual([[clientSpecifier]]);
    expect(peers.getSignedUrl).not.toHaveBeenCalled();

    const pending = disk.temporaryUrl('report.txt', 45);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBe('https://storage.example.test/signed');
    await expect(disk.temporaryUrl('other.txt')).resolves.toBe('https://storage.example.test/signed');
    expect(peers.load.mock.calls).toEqual([[clientSpecifier], [presignerSpecifier], [presignerSpecifier]]);
    expect(peers.constructClient).toHaveBeenCalledTimes(1);
    expect(peers.createRequire).toHaveBeenCalledTimes(3);
    expect(new Set(peers.createRequire.mock.calls.map(([url]) => url)).size).toBe(1);
    const [[client, first, firstOptions], [secondClient, second, secondOptions]] = peers.getSignedUrl.mock.calls;
    expect(client).toBeInstanceOf(Client);
    expect(secondClient).toBe(client);
    expect(first).toBeInstanceOf(GetObjectCommand);
    expect(first.input).toEqual({ Bucket: config.bucket, Key: 'tenant-a/report.txt' });
    expect(firstOptions).toEqual({ expiresIn: 45 });
    expect(second.input).toEqual({ Bucket: config.bucket, Key: 'tenant-a/other.txt' });
    expect(secondOptions).toEqual({ expiresIn: 3600 });
  });

  it('retains install guidance and the exact original cause for genuinely missing client and presigner peers', async () => {
    const { S3Disk } = await import('../src/storage/index.js');
    for (const specifier of [clientSpecifier, presignerSpecifier]) {
      const cause = Object.assign(new Error(`Cannot find module '${specifier}'`), { code: 'MODULE_NOT_FOUND' });
      peers.load.mockImplementation((name: string) => {
        if (name === specifier) throw cause;
        return loadPeer(name);
      });
      const disk = new S3Disk(config);
      const pending = specifier === clientSpecifier ? disk.ensureBucket() : disk.temporaryUrl('report.txt');
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toThrow(`Install it with: npm install ${specifier}`);
      const error = await pending.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(cause);
    }
    expect(peers.constructClient).not.toHaveBeenCalled();
    expect(peers.send).not.toHaveBeenCalled();
    expect(peers.getSignedUrl).not.toHaveBeenCalled();
  });

  it('preserves broken-load causes without claiming an installed client or presigner is missing', async () => {
    const { S3Disk } = await import('../src/storage/index.js');
    for (const specifier of [clientSpecifier, presignerSpecifier]) {
      for (const cause of [new SyntaxError('fixture module cannot initialize'), Object.assign(new Error('fixture incompatible module'), { code: 'ERR_REQUIRE_ESM' })]) {
        peers.load.mockImplementation((name: string) => {
          if (name === specifier) throw cause;
          return loadPeer(name);
        });
        const disk = new S3Disk(config);
        const pending = specifier === clientSpecifier ? disk.ensureBucket() : disk.temporaryUrl('report.txt');
        await expect(pending).rejects.toThrow(`could not load ${specifier}`);
        const error = await pending.catch((error: unknown) => error);
        expect((error as Error).cause).toBe(cause);
        expect((error as Error).message).toContain('original cause and dependency compatibility');
        expect((error as Error).message).not.toContain('Install it with');
      }
    }
    expect(peers.constructClient).not.toHaveBeenCalled();
    expect(peers.send).not.toHaveBeenCalled();
    expect(peers.getSignedUrl).not.toHaveBeenCalled();
  });
});
