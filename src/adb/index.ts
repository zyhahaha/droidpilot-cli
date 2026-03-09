// ADB Manager - High-level ADB Device Controller
// This is the main entry point for CLI application

import sharp from 'sharp';
import { AdbProtocol } from './protocol';
import type {
  ConnectionState,
  DeviceInfo,
  ScreenCapture,
} from './types';

/** 截图压缩配置 */
const SCREENSHOT_CONFIG = {
  /** 是否启用压缩（false 则返回原图） */
  enableCompression: false,
  /** 目标宽度（保持比例，仅压缩时生效） */
  targetWidth: 720,
  /** PNG 压缩级别 (0-9, 9为最高压缩) */
  compressionLevel: 9,
};

export { AdbProtocol } from './protocol';
export { AdbTransport } from './transport';
export * from './types';

/**
 * High-level ADB device controller.
 * Provides convenient methods for common ADB operations.
 */
export class AdbManager {
  private protocol: AdbProtocol;
  private _onStateChange?: (state: ConnectionState) => void;

  constructor(onStateChange?: (state: ConnectionState) => void) {
    this._onStateChange = onStateChange;
    this.protocol = new AdbProtocol(onStateChange);
  }

  get state(): ConnectionState {
    return this.protocol.state;
  }

  get info(): DeviceInfo | null {
    return this.protocol.deviceInfo;
  }

  /** Request device access */
  async requestDevice(): Promise<{ serial: string; product: string; model: string }> {
    // Initialize protocol and request device
    await this.protocol['transport'].requestDevice();
    return {
      serial: 'pending',
      product: 'pending',
      model: 'pending',
    };
  }

  /** Connect to an Android device */
  async connect(): Promise<DeviceInfo> {
    return await this.protocol.connect();
  }

  /** Disconnect from the device */
  async disconnect(): Promise<void> {
    return await this.protocol.disconnect();
  }

  /** Execute a shell command */
  async shell(command: string): Promise<string> {
    return await this.protocol.shell(command);
  }

  /** Capture the device screen as PNG (compressed)
   * @returns base64 - 压缩后的图片
   *          width/height - 原始分辨率（用于坐标转换）
   *          compressedWidth/compressedHeight - 压缩后尺寸（用于显示）
   */
  async captureScreen(): Promise<{
    base64: string;
    width: number;
    height: number;
    compressedWidth: number;
    compressedHeight: number;
  }> {
    // Use exec: instead of shell: to avoid PTY line ending conversion
    // which would corrupt binary PNG data
    const pngData = await this.protocol.execBinary('screencap -p');

    // Get original dimensions from PNG header
    let width = 0;
    let height = 0;
    if (pngData.length > 24) {
      width = pngData.readUInt32BE(16);
      height = pngData.readUInt32BE(20);
    }

    // Compress: resize to reduce resolution + PNG compression
    let resized: Buffer;
    if (SCREENSHOT_CONFIG.enableCompression) {
      resized = await sharp(pngData)
        .resize(SCREENSHOT_CONFIG.targetWidth, null, {
          // null height = auto maintain aspect ratio
          withoutEnlargement: true,
        })
        .png({
          compressionLevel: SCREENSHOT_CONFIG.compressionLevel,
          adaptiveFiltering: true,
          palette: false, // Keep full color for UI element recognition
        })
        .toBuffer();
    } else {
      // No compression, use original
      resized = pngData;
    }

    const base64 = resized.toString('base64');

    // Get compressed dimensions
    let compressedWidth: number;
    let compressedHeight: number;
    if (SCREENSHOT_CONFIG.enableCompression) {
      const metadata = await sharp(resized).metadata();
      compressedWidth = metadata.width ?? width;
      compressedHeight = metadata.height ?? height;
    } else {
      compressedWidth = width;
      compressedHeight = height;
    }

    // Log compression info
    const originalSizeKB = (pngData.length / 1024).toFixed(1);
    const compressedSizeKB = (resized.length / 1024).toFixed(1);
    if (SCREENSHOT_CONFIG.enableCompression) {
      const ratio = ((1 - resized.length / pngData.length) * 100).toFixed(0);
      console.log(`[Screenshot] ${width}x${height} (${originalSizeKB}KB) → ${compressedWidth}x${compressedHeight} (${compressedSizeKB}KB, -${ratio}%)`);
    } else {
      console.log(`[Screenshot] ${width}x${height} (${originalSizeKB}KB) - no compression`);
    }

    return {
      base64,
      width,              // 原始尺寸（用于坐标转换）
      height,             // 原始尺寸（用于坐标转换）
      compressedWidth,    // 压缩后尺寸（用于显示）
      compressedHeight,   // 压缩后尺寸（用于显示）
    };
  }

  /** Tap at a specific position */
  async tap(x: number, y: number): Promise<void> {
    await this.protocol.shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
  }

  /** Long press at a specific position */
  async longPress(x: number, y: number, duration = 1000): Promise<void> {
    await this.protocol.shell(
      `input swipe ${Math.round(x)} ${Math.round(y)} ${Math.round(x)} ${Math.round(y)} ${duration}`
    );
  }

  /** Swipe gesture */
  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration = 300
  ): Promise<void> {
    await this.protocol.shell(
      `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${duration}`
    );
  }

  /** Type text (supports Chinese and other Unicode characters via ADBKeyboard) */
  async typeText(text: string): Promise<void> {
    // Check if text contains non-ASCII characters (e.g., Chinese)
    const hasUnicode = /[\u0080-\uFFFF]/.test(text);

    if (hasUnicode) {
      // For Unicode text, use ADBKeyboard
      await this.typeWithAdbKeyboard(text);
    } else {
      // Use input text for ASCII-only text (faster)
      const escaped = text.replace(/([\\'"$`!&|;()<>])/g, '\\$1').replace(/ /g, '%s');
      await this.protocol.shell(`input text "${escaped}"`);
    }
  }

  /**
   * Type text using ADBKeyboard
   * ADBKeyboard is a special input method designed for ADB automation
   * Install: adb install ADBKeyboard.apk
   * Enable: Settings -> Language & Input -> Enable ADBKeyboard
   * Download: https://github.com/senzhk/ADBKeyBoard
   */
  private async typeWithAdbKeyboard(text: string): Promise<void> {
    // Switch to ADBKeyboard
    await this.protocol.shell('ime set com.android.adbkeyboard/.AdbIME');
    await this.delay(200);

    // Send text via broadcast
    // Escape single quotes for shell
    const escaped = text.replace(/'/g, "'\\''");
    await this.protocol.shell(`am broadcast -a ADB_INPUT_TEXT --es msg '${escaped}'`);

    // Wait for input to complete
    await this.delay(300);
  }

  /** Helper: delay */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Send a key event */
  async keyEvent(keycode: number): Promise<void> {
    await this.protocol.shell(`input keyevent ${keycode}`);
  }

  /** Press Home button */
  async home(): Promise<void> {
    await this.keyEvent(3);
  }

  /** Press Back button */
  async back(): Promise<void> {
    await this.keyEvent(4);
  }

  /** Open recent apps */
  async recentApps(): Promise<void> {
    await this.keyEvent(187);
  }

  /** Get device screen resolution */
  async getScreenSize(): Promise<{ width: number; height: number }> {
    const output = await this.protocol.shell('wm size');
    const match = output.match(/(\d+)x(\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
    return { width: 1080, height: 1920 }; // Default fallback
  }

  /** Get current activity/package info */
  async getCurrentActivity(): Promise<string> {
    const output = await this.protocol.shell(
      'dumpsys window displays | grep -E "mCurrentFocus|mFocusedApp"'
    );
    return output.trim();
  }

  /** Check if ADB is supported (always true in CLI) */
  static isSupported(): boolean {
    return AdbProtocol.isSupported();
  }
}
