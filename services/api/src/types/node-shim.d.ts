declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
  }

  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(data?: string): void;
  }

  export function createServer(
    requestListener: (req: IncomingMessage, res: ServerResponse) => void
  ): {
    listen(port: number, host: string, callback?: () => void): void;
  };
}

declare const process: {
  env: Record<string, string | undefined>;
};
