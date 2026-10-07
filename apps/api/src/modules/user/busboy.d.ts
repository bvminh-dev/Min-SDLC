// busboy 1.x không kèm kiểu; chỉ khai phần USR dùng (đọc multipart/form-data có giới hạn).
declare module 'busboy' {
  import type { Readable, Writable } from 'node:stream';
  import type { IncomingHttpHeaders } from 'node:http';
  interface FileInfo { filename: string; encoding: string; mimeType: string }
  interface BusboyConfig { headers: IncomingHttpHeaders; limits?: { fileSize?: number; files?: number; fields?: number; parts?: number; headerPairs?: number } }
  interface Busboy extends Writable {
    on(event: 'file', cb: (name: string, stream: Readable & { truncated?: boolean }, info: FileInfo) => void): this;
    on(event: 'field', cb: (name: string, value: string) => void): this;
    on(event: 'close' | 'finish', cb: () => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
  }
  function busboy(config: BusboyConfig): Busboy;
  export = busboy;
}
