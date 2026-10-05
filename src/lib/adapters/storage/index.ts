// Storage: VercelBlobStorage | S3Storage (MinIO) | LocalStorage (disco).
// Chaves são caminhos relativos ("projects/<id>/sources/a.mp4"). O navegador
// sempre recebe uma URL pública (publicUrl) e o worker baixa/sobe arquivos locais.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {config} from '../../config';

export type UploadTarget =
  | {mode: 'local'; url: string; method: 'PUT'}
  | {mode: 'vercel-blob'; handleUploadUrl: string; pathname: string}
  | {mode: 's3'; url: string; method: 'PUT'};

export interface Storage {
  readonly kind: 'local' | 'vercel-blob' | 's3';
  publicUrl(key: string): string;
  /** URL para o render acessar (pode ser diferente da pública, ex.: rede interna) */
  renderUrl(key: string): string;
  put(key: string, body: Buffer | string, contentType?: string): Promise<string>;
  putFile(key: string, localPath: string, contentType?: string): Promise<string>;
  download(key: string, localPath: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(prefix: string): Promise<void>;
  uploadTarget(key: string, contentType: string): Promise<UploadTarget>;
}

export const BLOB_MISSING =
  'Armazenamento não configurado: na Vercel, abra o projeto → Storage → crie/conecte um Blob store (ele cria BLOB_READ_WRITE_TOKEN) e faça Redeploy. Sem isso o vídeo passaria pela função, que aceita no máximo 4,5 MB (erro 413).';

const isUrl = (s: string) => /^https?:\/\//.test(s);

// ---------------------------------------------------------------- local

export class LocalStorage implements Storage {
  readonly kind = 'local' as const;
  constructor(private root = path.join(config.dataDir, 'storage')) {}
  file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error('chave inválida');
    return p;
  }
  publicUrl(key: string) {
    return isUrl(key) ? key : `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  renderUrl(key: string) {
    if (isUrl(key)) return key;
    const base = process.env.RENDER_MEDIA_BASE_URL ?? config.publicBaseUrl;
    return `${base.replace(/\/$/, '')}${this.publicUrl(key)}`;
  }
  async put(key: string, body: Buffer | string) {
    const f = this.file(key);
    await fsp.mkdir(path.dirname(f), {recursive: true});
    await fsp.writeFile(f, body);
    return key;
  }
  async putFile(key: string, localPath: string) {
    const f = this.file(key);
    if (path.resolve(localPath) === f) return key;
    await fsp.mkdir(path.dirname(f), {recursive: true});
    await fsp.copyFile(localPath, f);
    return key;
  }
  async download(key: string, localPath: string) {
    if (isUrl(key)) return downloadUrl(key, localPath);
    await fsp.mkdir(path.dirname(localPath), {recursive: true});
    if (path.resolve(localPath) !== this.file(key)) await fsp.copyFile(this.file(key), localPath);
  }
  async exists(key: string) {
    return fs.existsSync(this.file(key));
  }
  async delete(prefix: string) {
    await fsp.rm(this.file(prefix), {recursive: true, force: true});
  }
  async uploadTarget(key: string): Promise<UploadTarget> {
    // na Vercel o arquivo passaria pela função (limite de 4,5 MB → erro 413) e o
    // disco não é compartilhado com a Sandbox: exige o Blob
    if (process.env.VERCEL) throw new Error(BLOB_MISSING);
    return {mode: 'local', url: `/api/upload/local?key=${encodeURIComponent(key)}`, method: 'PUT'};
  }
}

// ---------------------------------------------------------------- Vercel Blob

export class VercelBlobStorage implements Storage {
  readonly kind = 'vercel-blob' as const;
  // as chaves guardadas no plano são as URLs públicas do Blob
  publicUrl(key: string) {
    return key;
  }
  renderUrl(key: string) {
    return key;
  }
  async put(key: string, body: Buffer | string, contentType?: string) {
    const {put} = await import('@vercel/blob');
    const r = await put(key, body, {access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true});
    return r.url;
  }
  async putFile(key: string, localPath: string, contentType?: string) {
    const {put} = await import('@vercel/blob');
    const r = await put(key, fs.createReadStream(localPath), {access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true, multipart: true});
    return r.url;
  }
  async download(key: string, localPath: string) {
    return downloadUrl(key, localPath);
  }
  async exists(key: string) {
    const {head} = await import('@vercel/blob');
    try {
      await head(key);
      return true;
    } catch {
      return false;
    }
  }
  async delete(prefix: string) {
    const {list, del} = await import('@vercel/blob');
    const {blobs} = await list({prefix});
    if (blobs.length) await del(blobs.map((b) => b.url));
  }
  async uploadTarget(key: string): Promise<UploadTarget> {
    // upload direto do navegador ao Blob (contorna o limite de 4,5 MB das funções)
    return {mode: 'vercel-blob', handleUploadUrl: '/api/upload/blob', pathname: key};
  }
}

// ---------------------------------------------------------------- S3 / MinIO

export class S3Storage implements Storage {
  readonly kind = 's3' as const;
  private clientP = (async () => {
    const {S3Client} = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint || undefined,
      forcePathStyle: Boolean(config.s3.endpoint),
      credentials: config.s3.accessKeyId ? {accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey} : undefined,
    });
  })();
  publicUrl(key: string) {
    if (isUrl(key)) return key;
    const base = config.s3.publicUrl || `${config.s3.endpoint}/${config.s3.bucket}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
  renderUrl(key: string) {
    // dentro do Docker o render enxerga o MinIO pela rede interna
    if (!isUrl(key) && process.env.RENDER_MEDIA_BASE_URL) return `${process.env.RENDER_MEDIA_BASE_URL.replace(/\/$/, '')}/${config.s3.bucket}/${key}`;
    return this.publicUrl(key);
  }
  async put(key: string, body: Buffer | string, contentType?: string) {
    const {PutObjectCommand} = await import('@aws-sdk/client-s3');
    await (await this.clientP).send(new PutObjectCommand({Bucket: config.s3.bucket, Key: key, Body: body, ContentType: contentType}));
    return key;
  }
  async putFile(key: string, localPath: string, contentType?: string) {
    const {PutObjectCommand} = await import('@aws-sdk/client-s3');
    const stat = await fsp.stat(localPath);
    await (await this.clientP).send(
      new PutObjectCommand({Bucket: config.s3.bucket, Key: key, Body: fs.createReadStream(localPath), ContentType: contentType, ContentLength: stat.size}),
    );
    return key;
  }
  async download(key: string, localPath: string) {
    if (isUrl(key)) return downloadUrl(key, localPath);
    const {GetObjectCommand} = await import('@aws-sdk/client-s3');
    const r = await (await this.clientP).send(new GetObjectCommand({Bucket: config.s3.bucket, Key: key}));
    await fsp.mkdir(path.dirname(localPath), {recursive: true});
    await pipeline(r.Body as Readable, fs.createWriteStream(localPath));
  }
  async exists(key: string) {
    const {HeadObjectCommand} = await import('@aws-sdk/client-s3');
    try {
      await (await this.clientP).send(new HeadObjectCommand({Bucket: config.s3.bucket, Key: key}));
      return true;
    } catch {
      return false;
    }
  }
  async delete(prefix: string) {
    const {ListObjectsV2Command, DeleteObjectsCommand} = await import('@aws-sdk/client-s3');
    const c = await this.clientP;
    const r = await c.send(new ListObjectsV2Command({Bucket: config.s3.bucket, Prefix: prefix}));
    const keys = (r.Contents ?? []).map((o) => ({Key: o.Key!}));
    if (keys.length) await c.send(new DeleteObjectsCommand({Bucket: config.s3.bucket, Delete: {Objects: keys}}));
  }
  async uploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    const {PutObjectCommand} = await import('@aws-sdk/client-s3');
    const {getSignedUrl} = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(await this.clientP, new PutObjectCommand({Bucket: config.s3.bucket, Key: key, ContentType: contentType}), {expiresIn: 3600});
    return {mode: 's3', url, method: 'PUT'};
  }
}

export async function downloadUrl(url: string, localPath: string) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download falhou (${r.status}): ${url}`);
  await fsp.mkdir(path.dirname(localPath), {recursive: true});
  await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), fs.createWriteStream(localPath));
}

let instance: Storage | null = null;
export function getStorage(): Storage {
  if (instance) return instance;
  instance = config.storage === 'vercel-blob' ? new VercelBlobStorage() : config.storage === 's3' ? new S3Storage() : new LocalStorage();
  return instance;
}
