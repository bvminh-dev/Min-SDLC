import { createServer, connect, type Server, type Socket } from 'node:net';

/** Proxy TCP tới PostgreSQL thật: cho phép "ngắt CSDL" giữa test mà không dừng container dùng chung. */
export class DbProxy {
  private server!: Server;
  private sockets = new Set<Socket>();
  port = 0;
  constructor(private readonly target = { host: 'localhost', port: 5433 }) {}

  async start(port = 0): Promise<void> {
    this.server = createServer((client) => {
      const up = connect(this.target);
      this.sockets.add(client); this.sockets.add(up);
      client.pipe(up).pipe(client);
      const done = () => { client.destroy(); up.destroy(); this.sockets.delete(client); this.sockets.delete(up); };
      client.on('error', done); up.on('error', done); client.on('close', done); up.on('close', done);
    });
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.port = (this.server.address() as { port: number }).port;
  }
  /** Ngắt mọi kết nối và đóng cổng (CSDL "mất"). */
  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
