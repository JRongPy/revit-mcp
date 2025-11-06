import * as net from "net";

export class RevitClientConnection {
  host: string;
  port: number;
  socket: net.Socket;
  isConnected: boolean = false;
  responseCallbacks: Map<string, (response: string) => void> = new Map();
  
  // Buffer for incomplete messages
  private lengthBuffer: Buffer = Buffer.alloc(0);
  private messageBuffer: Buffer = Buffer.alloc(0);
  private expectedLength: number | null = null;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    this.socket = new net.Socket();
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    this.socket.on("connect", () => {
      this.isConnected = true;
    });

    this.socket.on("data", (data: Buffer) => {
      this.processData(data);
    });

    this.socket.on("close", () => {
      this.isConnected = false;
    });

    this.socket.on("error", (error) => {
      console.error("RevitClientConnection error:", error);
      this.isConnected = false;
    });
  }

  private processData(data: Buffer): void {
    let offset = 0;

    while (offset < data.length) {
      // === 第一階段：讀取長度前綴 ===
      if (this.expectedLength === null) {
        // 需要 4 bytes 的長度前綴
        const needed = 4 - this.lengthBuffer.length;
        const available = data.length - offset;
        const toCopy = Math.min(needed, available);

        // 累積長度前綴
        this.lengthBuffer = Buffer.concat([
          this.lengthBuffer,
          data.slice(offset, offset + toCopy)
        ]);
        offset += toCopy;

        // 如果長度前綴已完整
        if (this.lengthBuffer.length === 4) {
          this.expectedLength = this.lengthBuffer.readInt32BE(0);
          this.lengthBuffer = Buffer.alloc(0); // 清空

          // 防禦檢查
          if (this.expectedLength <= 0 || this.expectedLength > 10 * 1024 * 1024) {
            console.error(`Invalid message length: ${this.expectedLength}`);
            this.resetBuffers();
            return;
          }
        }
      }

      // === 第二階段：讀取消息內容 ===
      if (this.expectedLength !== null) {
        const needed = this.expectedLength - this.messageBuffer.length;
        const available = data.length - offset;
        const toCopy = Math.min(needed, available);

        // 累積消息內容
        this.messageBuffer = Buffer.concat([
          this.messageBuffer,
          data.slice(offset, offset + toCopy)
        ]);
        offset += toCopy;

        // 如果消息已完整
        if (this.messageBuffer.length === this.expectedLength) {
          const jsonStr = this.messageBuffer.toString('utf8');
          this.handleResponse(jsonStr);
          
          // 重置狀態，準備接收下一條消息
          this.resetBuffers();
        }
      }
    }
  }

  private resetBuffers(): void {
    this.lengthBuffer = Buffer.alloc(0);
    this.messageBuffer = Buffer.alloc(0);
    this.expectedLength = null;
  }

  private handleResponse(responseData: string): void {
    try {
      const response = JSON.parse(responseData);
      const requestId = response.id || "default";

      const callback = this.responseCallbacks.get(requestId);
      if (callback) {
        callback(responseData);
        this.responseCallbacks.delete(requestId);
      }
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response data:", responseData);
    }
  }

  public connect(): boolean {
    if (this.isConnected) {
      return true;
    }

    try {
      this.socket.connect(this.port, this.host);
      return true;
    } catch (error) {
      console.error("Failed to connect:", error);
      return false;
    }
  }

  public disconnect(): void {
    this.socket.end();
    this.isConnected = false;
  }

  private generateRequestId(): string {
    return Date.now().toString() + Math.random().toString().substring(2, 8);
  }

  public sendCommand(command: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.isConnected) {
          this.connect();
        }

        const requestId = this.generateRequestId();

        const commandObj = {
          jsonrpc: "2.0",
          method: command,
          params: params,
          id: requestId,
        };

        this.responseCallbacks.set(requestId, (responseData) => {
          try {
            const response = JSON.parse(responseData);
            if (response.error) {
              reject(
                new Error(response.error.message || "Unknown error from Revit")
              );
            } else {
              resolve(response.result);
            }
          } catch (error) {
            if (error instanceof Error) {
              reject(new Error(`Failed to parse response: ${error.message}`));
            } else {
              reject(new Error(`Failed to parse response: ${String(error)}`));
            }
          }
        });

        const commandString = JSON.stringify(commandObj);
        const messageBody = Buffer.from(commandString, 'utf8');
        
        // === 發送：4 bytes 長度 + 消息內容 ===
        const lengthPrefix = Buffer.alloc(4);
        lengthPrefix.writeInt32BE(messageBody.length, 0);
        
        this.socket.write(Buffer.concat([lengthPrefix, messageBody]));

        setTimeout(() => {
          if (this.responseCallbacks.has(requestId)) {
            this.responseCallbacks.delete(requestId);
            reject(new Error(`Command timed out after 2 minutes: ${command}`));
          }
        }, 120000);
      } catch (error) {
        reject(error);
      }
    });
  }
}