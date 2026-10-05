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
  // presigned: store no modo sem chave (OIDC) → o navegador usa uploadPresigned
  | {mode: 'vercel-blob'; handleUploadUrl: string; pathname: string; presigned?: boolean}
  | {mode: 's3'; url: string; method: 'PUT'; headers?: Record<string, string>};

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
  /** link temporário para ler um arquivo privado (navegador/render); o próprio link se for público */
  signedUrl?(keyOrUrl: string): Promise<string>;
}

export const BLOB_MISSING =
  'Armazenamento não configurado: na Vercel, abra o projeto → Storage → crie/conecte um Blob store (ele cria BLOB_STORE_ID ou BLOB_READ_WRITE_TOKEN) e faça Redeploy. Sem isso o vídeo passaria pela função, que aceita no máximo 4,5 MB (erro 413).';

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

const isPrivateBlob = (u: string) => /\.private\.blob\.vercel-storage\.com\//.test(u);
type Access = 'public' | 'private';

export class VercelBlobStorage implements Storage {
  readonly kind = 'vercel-blob' as const;
  // store público ou privado: BLOB_ACCESS manda; senão tenta o provável e troca se o Blob recusar
  private access: Access = (process.env.BLOB_ACCESS as Access | undefined) ?? (process.env.BLOB_READ_WRITE_TOKEN ? 'public' : 'private');
  private signer: Promise<import('@vercel/blob').IssuedSignedToken> | null = null;
  private signerUntil = 0;

  // as chaves guardadas no plano são as URLs do Blob. Store privado: o navegador
  // passa por /api/media (exige login), que redireciona para um link assinado temporário
  publicUrl(key: string) {
    return isPrivateBlob(key) ? `/api/media?u=${encodeURIComponent(key)}` : key;
  }
  renderUrl(key: string) {
    return key;
  }
  /** link assinado (store privado) — o mesmo URL se o blob for público */
  async signedUrl(url: string): Promise<string> {
    if (!isPrivateBlob(url)) return url;
    const {issueSignedToken, presignUrl} = await import('@vercel/blob');
    // token de 8 h renovado quando faltam 3 h: todo link entregue vale pelo menos 3 h
    // e é o mesmo entre chamadas (o player não recarrega o vídeo a cada salvamento)
    if (!this.signer || Date.now() > this.signerUntil - 3 * 3600e3) {
      const until = Date.now() + 8 * 3600e3;
      this.signerUntil = until;
      // se o Blob recusar a validade longa, usa a padrão dele (1 h) e renova antes
      this.signer = issueSignedToken({operations: ['get', 'head'], validUntil: until}).catch(() => {
        this.signerUntil = Date.now() + 40 * 60e3 + 3 * 3600e3; // renova aos 40 min de 1 h
        return issueSignedToken({operations: ['get', 'head']});
      });
      this.signer.catch(() => (this.signer = null));
    }
    const pathname = decodeURIComponent(new URL(url).pathname.slice(1));
    return (await presignUrl(await this.signer, {operation: 'get', pathname, access: 'private'})).presignedUrl;
  }
  private async withAccess<T>(fn: (access: Access) => Promise<T>): Promise<T> {
    try {
      return await fn(this.access);
    } catch (e) {
      if (!/access|private|public/i.test(String(e))) throw e;
      const other: Access = this.access === 'public' ? 'private' : 'public';
      const r = await fn(other);
      this.access = other;
      return r;
    }
  }
  async put(key: string, body: Buffer | string, contentType?: string) {
    const {put} = await import('@vercel/blob');
    const r = await this.withAccess((access) => put(key, body, {access, contentType, addRandomSuffix: false, allowOverwrite: true}));
    return r.url;
  }
  async putFile(key: string, localPath: string, contentType?: string) {
    const {put} = await import('@vercel/blob');
    const r = await this.withAccess((access) => put(key, fs.createReadStream(localPath), {access, contentType, addRandomSuffix: false, allowOverwrite: true, multipart: true}));
    return r.url;
  }
  async download(key: string, localPath: string) {
    let url = key;
    if (!isUrl(key)) {
      const {head} = await import('@vercel/blob');
      url = (await head(key)).url;
    }
    return downloadUrl(await this.signedUrl(url), localPath);
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
    for (let cursor: string | undefined; ; ) {
      const r = await list({prefix, cursor});
      if (r.blobs.length) await del(r.blobs.map((b) => b.url));
      if (!r.hasMore) break;
      cursor = r.cursor;
    }
  }
  async uploadTarget(key: string): Promise<UploadTarget> {
    // upload direto do navegador ao Blob (contorna o limite de 4,5 MB das funções)
    return {mode: 'vercel-blob', handleUploadUrl: '/api/upload/blob', pathname: key, presigned: !process.env.BLOB_READ_WRITE_TOKEN};
  }
}

/** troca as URLs de um mapa de mídia por links assinados (Blob/S3 privados), para o render */
export async function signMedia(media: Record<string, string>, storage: Storage): Promise<Record<string, string>> {
  if (!storage.signedUrl || (storage.kind === 's3' && process.env.RENDER_MEDIA_BASE_URL)) return media;
  const out: Record<string, string> = {};
  for (const k of Object.keys(media)) out[k] = await storage.signedUrl(k);
  return out;
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
  /** bucket público (S3_PUBLIC_URL definido): links diretos; senão, links assinados */
  private get isPublic() {
    return Boolean(config.s3.publicUrl);
  }
  /** vídeos antigos que ficaram no Vercel Blob privado continuam abrindo */
  private legacyBlob = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? new VercelBlobStorage() : null;

  publicUrl(key: string) {
    if (isPrivateBlob(key) || (!isUrl(key) && !this.isPublic)) return `/api/media?u=${encodeURIComponent(key)}`;
    if (isUrl(key)) return key;
    return `${config.s3.publicUrl.replace(/\/$/, '')}/${key}`;
  }
  renderUrl(key: string) {
    // dentro do Docker o render enxerga o MinIO pela rede interna
    if (!isUrl(key) && process.env.RENDER_MEDIA_BASE_URL) return `${process.env.RENDER_MEDIA_BASE_URL.replace(/\/$/, '')}/${config.s3.bucket}/${key}`;
    return key;
  }
  /**
   * Link assinado de leitura. A data de assinatura é arredondada para janelas de 6 h e o
   * link vale 12 h: dentro da janela o link é sempre o mesmo (o player não recarrega a
   * cada salvamento) e todo link entregue vale pelo menos 6 h.
   */
  async signedUrl(keyOrUrl: string): Promise<string> {
    if (isPrivateBlob(keyOrUrl)) return this.legacyBlob ? this.legacyBlob.signedUrl(keyOrUrl) : keyOrUrl;
    if (isUrl(keyOrUrl)) return keyOrUrl;
    if (this.isPublic) return this.publicUrl(keyOrUrl);
    const {GetObjectCommand} = await import('@aws-sdk/client-s3');
    const {getSignedUrl} = await import('@aws-sdk/s3-request-presigner');
    const WINDOW = 6 * 3600e3;
    const signingDate = new Date(Math.floor(Date.now() / WINDOW) * WINDOW);
    return getSignedUrl(await this.clientP, new GetObjectCommand({Bucket: config.s3.bucket, Key: keyOrUrl}), {expiresIn: 12 * 3600, signingDate});
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
    if (isPrivateBlob(key)) return downloadUrl(await this.signedUrl(key), localPath);
    if (isUrl(key)) return downloadUrl(key, localPath);
    const {GetObjectCommand} = await import('@aws-sdk/client-s3');
    const r = await (await this.clientP).send(new GetObjectCommand({Bucket: config.s3.bucket, Key: key}));
    await fsp.mkdir(path.dirname(localPath), {recursive: true});
    await pipeline(r.Body as Readable, fs.createWriteStream(localPath));
  }
  async exists(key: string) {
    if (isUrl(key)) return false;
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
    for (let token: string | undefined; ; ) {
      const r = await c.send(new ListObjectsV2Command({Bucket: config.s3.bucket, Prefix: prefix, ContinuationToken: token}));
      const keys = (r.Contents ?? []).map((o) => ({Key: o.Key!}));
      if (keys.length) await c.send(new DeleteObjectsCommand({Bucket: config.s3.bucket, Delete: {Objects: keys}}));
      if (!r.IsTruncated) break;
      token = r.NextContinuationToken;
    }
    // vídeos antigos do projeto que ainda estão no Blob
    await this.legacyBlob?.delete(prefix).catch(() => undefined);
  }
  async uploadTarget(key: string, contentType: string): Promise<UploadTarget> {
    const {PutObjectCommand} = await import('@aws-sdk/client-s3');
    const {getSignedUrl} = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(await this.clientP, new PutObjectCommand({Bucket: config.s3.bucket, Key: key, ContentType: contentType}), {expiresIn: 6 * 3600});
    // o navegador precisa mandar exatamente o content-type assinado (senão o S3 responde 403)
    return {mode: 's3', url, method: 'PUT', headers: {'Content-Type': contentType}};
  }

  /** confere a conexão: cria o bucket se faltar, grava, lê por link assinado e apaga */
  async check(): Promise<{ok: boolean; steps: string[]}> {
    const steps: string[] = [];
    const {HeadBucketCommand, CreateBucketCommand} = await import('@aws-sdk/client-s3');
    const c = await this.clientP;
    try {
      await c.send(new HeadBucketCommand({Bucket: config.s3.bucket}));
      steps.push(`bucket "${config.s3.bucket}" encontrado`);
    } catch {
      await c.send(new CreateBucketCommand({Bucket: config.s3.bucket}));
      steps.push(`bucket "${config.s3.bucket}" criado`);
    }
    const key = `cache/check-${Date.now()}.txt`;
    await this.put(key, 'ok', 'text/plain');
    steps.push('gravação ok');
    const url = await this.signedUrl(key);
    const r = await fetch(url);
    const body = await r.text();
    steps.push(r.ok && body === 'ok' ? 'leitura por link ok' : `leitura falhou (${r.status})`);
    await this.delete(key);
    steps.push('exclusão ok');
    return {ok: r.ok && body === 'ok', steps};
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
