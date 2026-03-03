// ADB Protocol Constants and Types

/** ADB protocol version */
export const ADB_VERSION = 0x01000000;

/** Maximum data payload size */
export const MAX_PAYLOAD = 4096;

/** ADB command constants */
export const ADB_COMMANDS = {
  CNXN: 0x4e584e43, // CONNECT
  AUTH: 0x48545541, // AUTH
  OPEN: 0x4e45504f, // OPEN
  OKAY: 0x59414b4f, // OKAY
  CLSE: 0x45534c43, // CLOSE
  WRTE: 0x45545257, // WRITE
} as const;

/** Auth types */
export const AUTH_TYPE = {
  TOKEN: 1,
  SIGNATURE: 2,
  RSAPUBLICKEY: 3,
} as const;

/** ADB message header (24 bytes) */
export interface AdbMessage {
  command: number;
  arg0: number;
  arg1: number;
  dataLength: number;
  dataCrc32: number;
  magic: number;
}

/** Complete ADB message with optional payload */
export interface AdbPacket {
  header: AdbMessage;
  data?: Buffer;
}

/** Device connection state */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

/** Device info after connection */
export interface DeviceInfo {
  serial: string;
  product: string;
  model: string;
  device: string;
  features: string[];
}

/** Screen capture result */
export interface ScreenCapture {
  width: number;
  height: number;
  imageData: Buffer;
  base64: string;
  timestamp: number;
}

/** Common Android keycodes */
export const KEYCODE = {
  HOME: 3,
  BACK: 4,
  POWER: 26,
  MENU: 82,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  ENTER: 66,
  DELETE: 67,
  TAB: 61,
  RECENT_APPS: 187,
} as const;
