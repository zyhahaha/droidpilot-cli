// ADB Command Line Transport Layer
// Uses system adb command for device communication

import { spawn } from 'child_process';
import type { DeviceInfo, ConnectionState } from './types';

/**
 * ADB CLI Transport for device communication.
 * Uses system adb command line tool.
 */
export class AdbTransport {
  private deviceSerial: string | null = null;
  private _state: ConnectionState = 'disconnected';
  private _deviceInfo: DeviceInfo | null = null;
  private onStateChange?: (state: ConnectionState) => void;

  constructor(onStateChange?: (state: ConnectionState) => void) {
    this.onStateChange = onStateChange;
  }

  get state(): ConnectionState {
    return this._state;
  }

  get deviceInfo(): DeviceInfo | null {
    return this._deviceInfo;
  }

  private setState(state: ConnectionState) {
    this._state = state;
    this.onStateChange?.(state);
  }

  /** Execute adb command and return stdout */
  private execAdb(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const cmd = ['adb', ...args].join(' ');
      const proc = spawn(cmd, [], { shell: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `adb exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`无法执行 adb 命令: ${err.message}`));
      });
    });
  }

  /** Execute adb command and return Buffer for binary data */
  private execAdbBuffer(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const cmd = ['adb', ...args].join(' ');
      const proc = spawn(cmd, [], { shell: true });
      const chunks: Buffer[] = [];
      let stderr = '';

      proc.stdout.on('data', (data) => {
        chunks.push(Buffer.from(data));
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(stderr || `adb exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`无法执行 adb 命令: ${err.message}`));
      });
    });
  }

  /** Check if adb is available */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('adb version', [], { shell: true });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  /** Check if USB is supported (always true for CLI) */
  static isSupported(): boolean {
    return true;
  }

  /** Find connected Android devices */
  static async findDevices(): Promise<{ serial: string; status: string }[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn('adb devices', [], { shell: true });
      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const lines = stdout.split('\n').slice(1); // Skip header
          const devices = lines
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
              const [serial, status] = line.split('\t');
              return { serial, status };
            })
            .filter(d => d.status === 'device');
          resolve(devices);
        } else {
          reject(new Error('无法获取设备列表'));
        }
      });

      proc.on('error', () => resolve([]));
    });
  }

  /** Request access to a device */
  async requestDevice(): Promise<void> {
    const devices = await AdbTransport.findDevices();
    if (devices.length === 0) {
      throw new Error('未找到 Android 设备。请确保设备已连接并开启了 USB 调试模式。');
    }
    this.deviceSerial = devices[0].serial;
  }

  /** Connect to device and get info */
  async connect(): Promise<DeviceInfo> {
    try {
      this.setState('connecting');

      if (!this.deviceSerial) {
        await this.requestDevice();
      }

      this.setState('authenticating');

      // Get device properties
      const [model, product, device, serial] = await Promise.all([
        this.execAdb(['-s', this.deviceSerial!, 'shell', 'getprop', 'ro.product.model']).catch(() => 'Unknown'),
        this.execAdb(['-s', this.deviceSerial!, 'shell', 'getprop', 'ro.product.name']).catch(() => 'Unknown'),
        this.execAdb(['-s', this.deviceSerial!, 'shell', 'getprop', 'ro.product.device']).catch(() => 'Unknown'),
        Promise.resolve(this.deviceSerial!),
      ]);

      this._deviceInfo = {
        serial,
        model: model || 'Unknown',
        product: product || 'Unknown',
        device: device || 'Unknown',
        features: [],
      };

      this.setState('connected');
      return this._deviceInfo;
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  /** Execute shell command */
  async shell(command: string): Promise<string> {
    if (this._state !== 'connected' || !this.deviceSerial) {
      throw new Error('设备未连接');
    }
    return this.execAdb(['-s', this.deviceSerial, 'shell', command]);
  }

  /** Execute shell command and return binary data */
  async shellBinary(command: string): Promise<Buffer> {
    if (this._state !== 'connected' || !this.deviceSerial) {
      throw new Error('设备未连接');
    }
    return this.execAdbBuffer(['-s', this.deviceSerial, 'exec-out', command]);
  }

  /** Execute binary command (alias for shellBinary) */
  async execBinary(command: string): Promise<Buffer> {
    return this.shellBinary(command);
  }

  /** Disconnect from device */
  async disconnect(): Promise<void> {
    this._deviceInfo = null;
    this.deviceSerial = null;
    this.setState('disconnected');
  }

  get isConnected(): boolean {
    return this._state === 'connected' && this.deviceSerial !== null;
  }
}
