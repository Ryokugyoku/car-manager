import { contextBridge, ipcRenderer } from 'electron';

// preload では Electron の ipcRenderer をそのまま露出させず、
// OBD 通信に必要な API だけを安全にラップして renderer 側へ渡す。
export interface OBDApi {
  // 将来拡張: ASCカプラー専用モード等を追加するため、mode は文字列で受ける。
  connect: (portPath?: string) => Promise<{ success: boolean; message?: string }>;
  disconnect: () => Promise<{ success: boolean; message?: string }>;
  listPorts: () => Promise<
    Array<{ path: string; manufacturer: string; productId?: string; vendorId?: string }>
  >;
  startMonitoring: (mode?: string) => Promise<{ success: boolean; message?: string }>;
  stopMonitoring: () => Promise<{ success: boolean; message?: string }>;
  getSupportedModes: () => Promise<string[]>;
  getVehicleProfile: () => Promise<{
    vin: string | null;
    manufacturer: string;
    model: string;
    modelYear: string;
    engineCode: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  getStoragePaths: () => Promise<{
    rootDir: string;
    dbVolumeDir: string;
    masterSqlitePath: string;
    summaryDuckDbPath: string;
    driveLogReservationPath: string;
    ioMetricsDuckDbPath: string;
  }>;
  getStorageOverview: () => Promise<{
    rootDir: string;
    dbVolumeDir: string;
    totalBytes: number;
    freeBytes: number;
    dbVolumeSizeBytes: number;
    dbVolumeUsedBytes: number;
    dbVolumeUsagePercent: number;
    dbVolumeWarning: boolean;
    dbVolumeCritical: boolean;
    dbVolumeAutoCleanupPolicy: string;
    dbVolumeNotice: string | null;
    reservationPath: string;
    reservationConfiguredMb: number;
    reservationAllocatedBytes: number;
    reservationBytes: number;
    reservationUsagePercent: number;
    reservationWarning: boolean;
    ioLogDbPath: string;
    ioLogDbSizeBytes: number;
    ioLogDbLimitBytes: number;
    ioLogDbUsagePercent: number;
    ioLogDbLimitExceeded: boolean;
    databases: Array<{
      label: string;
      path: string;
      sizeBytes: number;
      capacityBytes: number;
      ioPercent: number;
    }>;
  }>;
  setLogReservationMb: (reservationMb: number) => Promise<{ success: boolean; message?: string; reservationBytes?: number }>;
  reallocateReservation: () => Promise<{ success: boolean; message?: string; reservationBytes?: number }>;
  listIoMetrics: (range: '1m' | '1h' | 'all') => Promise<Array<{
    sampledAt: string;
    sampledTimestampMs: number;
    driveLogDbSizeBytes: number;
    reservationBytes: number;
    reservationUsagePercent: number;
    writeDeltaBytes: number;
  }>>;
  listKnownVehicles: () => Promise<Array<{
    id: number;
    vinPattern: string;
    manufacturer: string;
    model: string;
    modelYear: string;
    engineCode: string;
  }>>;
  upsertKnownVehicle: (payload: {
    vinPattern: string;
    manufacturer: string;
    model: string;
    modelYear: string;
    engineCode: string;
  }) => Promise<{ success: boolean; message?: string }>;
  deleteKnownVehicle: (id: number) => Promise<{ success: boolean; message?: string }>;
  listConnectionHistory: () => Promise<Array<{
    id: number;
    vin: string | null;
    manufacturer: string;
    model: string;
    mode: string;
    portPath: string | null;
    connectedAt: string;
    disconnectedAt: string | null;
    disconnectReason: string | null;
  }>>;
  listDriveLogs: (limit?: number) => Promise<Array<{
    vin: string;
    sampleTimestampMs: number;
    sampleAt: string;
    manufacturer: string;
    model: string;
    mode: string;
    portPath: string | null;
    speed: number;
    rpm: number;
    engineTemp: number;
    engineOilTemp: number;
    atfTemp: number;
    fuelLevel: number;
    engineLoad: number;
    throttlePosition: number;
    timingAdvance: number;
    intakeAirTemp: number;
    manifoldPressure: number;
    maf: number;
    controlModuleVoltage: number;
  }>>;
  onConnectionState: (callback: (state: { connected: boolean; reason?: string }) => void) => () => void;
  onOBDData: (callback: (data: any) => void) => () => void;
}

const obdApi: OBDApi = {
  // main プロセスの接続処理を呼び出す。
  connect: (portPath?: string) => ipcRenderer.invoke('obd:connect', portPath),
  // main プロセスの切断処理を呼び出す。
  disconnect: () => ipcRenderer.invoke('obd:disconnect'),
  // 利用可能なシリアルポート一覧を取得する。
  listPorts: () => ipcRenderer.invoke('obd:list-ports'),
  // main 側で定期監視ループを開始する。
  startMonitoring: (mode?: string) => ipcRenderer.invoke('obd:start-monitoring', mode),
  // 定期監視を停止する。
  stopMonitoring: () => ipcRenderer.invoke('obd:stop-monitoring'),
  // main 側で利用可能な監視モード一覧を取得する。
  getSupportedModes: () => ipcRenderer.invoke('obd:supported-modes'),
  // 接続中車両のVINを元に推定したプロフィールを取得する。
  getVehicleProfile: () => ipcRenderer.invoke('vehicle:profile'),
  // SQLite/DuckDB の物理保存先を取得する。
  getStoragePaths: () => ipcRenderer.invoke('storage:paths'),
  // ストレージ全体とDBごとの使用状況を取得する。
  getStorageOverview: () => ipcRenderer.invoke('storage:overview'),
  // 予約容量をMB単位で設定する。
  setLogReservationMb: (reservationMb: number) => ipcRenderer.invoke('storage:set-log-reservation', reservationMb),
  // 現在設定されている予約容量で再確保を試みる。
  reallocateReservation: () => ipcRenderer.invoke('storage:reallocate-reservation'),
  // I/Oメトリクスの時系列を取得する。
  listIoMetrics: (range: '1m' | '1h' | 'all') => ipcRenderer.invoke('storage:io-metrics', range),
  // 既知車種マスタの一覧を取得する。
  listKnownVehicles: () => ipcRenderer.invoke('vehicles:list-known'),
  // 既知車種マスタへ登録または更新する。
  upsertKnownVehicle: (payload) => ipcRenderer.invoke('vehicles:upsert-known', payload),
  // 既知車種マスタから削除する。
  deleteKnownVehicle: (id) => ipcRenderer.invoke('vehicles:delete-known', id),
  // 接続履歴一覧を取得する。
  listConnectionHistory: () => ipcRenderer.invoke('history:list-connections'),
  // DuckDB の走行ログ一覧を取得する。
  listDriveLogs: (limit?: number) => ipcRenderer.invoke('drive-logs:list', limit),
  onConnectionState: (callback) => {
    ipcRenderer.on('obd:connection-state', (event, state) => {
      callback(state);
    });
    return () => {
      ipcRenderer.removeAllListeners('obd:connection-state');
    };
  },
  onOBDData: (callback) => {
    // main プロセスから送られてくるリアルタイムデータを購読する。
    ipcRenderer.on('obd:data', (event, data) => {
      callback(data);
    });
    // Angular 側の破棄時に購読解除できるよう、解除関数を返す。
    return () => {
      ipcRenderer.removeAllListeners('obd:data');
    };
  },
};

// window.obdApi として renderer 側へ公開する。
// これにより Angular は preload 経由でのみ main の機能に触れられる。
contextBridge.exposeInMainWorld('obdApi', obdApi);

declare global {
  interface Window {
    obdApi: OBDApi;
  }
}
