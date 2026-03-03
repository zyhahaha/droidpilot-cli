// ADB Protocol Implementation using CLI
// Simplified wrapper over AdbTransport

import { AdbTransport } from './transport';
import type { DeviceInfo, ConnectionState } from './types';

/**
 * ADB Protocol handler using command line adb.
 * Provides high-level ADB operations.
 */
export class AdbProtocol {
  private transport: AdbTransport;
  private _state: ConnectionState = 'disconnected';
  private _deviceInfo: DeviceInfo | null = null;
  private onStateChange?: (state: ConnectionState) => void;

  constructor(onStateChange?: (state: ConnectionState) => void) {
    this.onStateChange = onStateChange;
    this.transport = new AdbTransport((state) => {
      this._state = state;
      this.onStateChange?.(state);
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  get deviceInfo(): DeviceInfo | null {
    return this._deviceInfo;
  }

  /** Connect to an Android device */
  async connect(): Promise<DeviceInfo> {
    this._deviceInfo = await this.transport.connect();
    return this._deviceInfo;
  }

  /** Execute a shell command on the device */
  async shell(command: string): Promise<string> {
    return this.transport.shell(command);
  }

  /** Execute a shell command and get binary data */
  async shellBinary(command: string): Promise<Buffer> {
    return this.transport.shellBinary(command);
  }

  /** Execute a command and get binary data */
  async execBinary(command: string): Promise<Buffer> {
    return this.transport.execBinary(command);
  }

  /** Disconnect from the device */
  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this._deviceInfo = null;
  }

  /** Check if adb is available */
  static async isAvailable(): Promise<boolean> {
    return AdbTransport.isAvailable();
  }

  /** Check if ADB is supported */
  static isSupported(): boolean {
    return AdbTransport.isSupported();
  }
}
