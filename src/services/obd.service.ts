import { Injectable } from '@angular/core';
import { NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface OBDData {
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
  sampledFields?: Partial<Record<string, boolean>>;
  timestamp: number;
}

export interface VehicleProfile {
  vin: string | null;
  manufacturer: string;
  model: string;
  modelYear: string;
  engineCode: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface StoragePaths {
  rootDir: string;
  dbVolumeDir: string;
  masterSqlitePath: string;
  summaryDuckDbPath: string;
  driveLogReservationPath: string;
  ioMetricsDuckDbPath: string;
}

export interface StorageDatabaseUsage {
  label: string;
  path: string;
  sizeBytes: number;
  capacityBytes: number;
  ioPercent: number;
}

export interface StorageOverview {
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
  databases: StorageDatabaseUsage[];
}

export type IoMetricRange = '1m' | '1h' | 'all';

export interface IoMetricSample {
  sampledAt: string;
  sampledTimestampMs: number;
  driveLogDbSizeBytes: number;
  reservationBytes: number;
  reservationUsagePercent: number;
  writeDeltaBytes: number;
}

export interface SerialPortInfo {
  path: string;
  manufacturer: string;
  productId?: string;
  vendorId?: string;
}

export interface KnownVehicleRecord {
  id: number;
  vinPattern: string;
  manufacturer: string;
  model: string;
  modelYear: string;
  engineCode: string;
}

export interface ConnectionHistoryRecord {
  id: number;
  vin: string | null;
  manufacturer: string;
  model: string;
  mode: string;
  portPath: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  disconnectReason: string | null;
}

export interface DriveLogRecord {
  vin: string;
  sampleTimestampMs: number;
  sampleAt: string;
  manufacturer: string;
  model: string;
  mode: string;
  portPath: string | null;
  speed: number | null;
  rpm: number | null;
  engineTemp: number | null;
  engineOilTemp: number | null;
  atfTemp: number | null;
  fuelLevel: number | null;
  engineLoad: number | null;
  throttlePosition: number | null;
  timingAdvance: number | null;
  intakeAirTemp: number | null;
  manifoldPressure: number | null;
  maf: number | null;
  controlModuleVoltage: number | null;
}

export type MonitoringMode = 'obd2-standard' | 'asc-coupler';

@Injectable({
  providedIn: 'root',
})
export class OBDService {
  // 画面側が購読するリアルタイムデータの元ソース。
  // BehaviorSubject にすることで、後から購読したコンポーネントにも最新値を即時配布できる。
  private obdDataSubject = new BehaviorSubject<OBDData>({
    speed: 0,
    rpm: 0,
    engineTemp: 0,
    engineOilTemp: 0,
    atfTemp: 0,
    fuelLevel: 0,
    engineLoad: 0,
    throttlePosition: 0,
    timingAdvance: 0,
    intakeAirTemp: 0,
    manifoldPressure: 0,
    maf: 0,
    controlModuleVoltage: 0,
    timestamp: Date.now(),
  });

  public obdData$ = this.obdDataSubject.asObservable();

  // 接続状態のフラグ。
  // UI のボタン制御や状態表示に使う。
  private isConnected = false;

  // preload から登録した受信イベントの解除関数。
  // 再接続時や破棄時に二重購読しないようにする。
  private unlistener: (() => void) | null = null;

  constructor(private zone: NgZone) {
    // service 初期化時に、renderer からの OBD イベント購読をセットする。
    this.setupOBDListener();
  }

  /**
   * Electron IPC の OBD データリスナーを設定する。
   * main プロセスから届く data を NgZone 内で next し、Angular の変更検知を確実に走らせる。
   */
  private setupOBDListener() {
    const window = globalThis as any;

    if (this.unlistener) {
      // 再設定時は前回の購読を外して、イベントが多重登録されないようにする。
      this.unlistener();
      this.unlistener = null;
    }

    if (window.obdApi) {
      this.unlistener = window.obdApi.onOBDData((data: OBDData) => {
        // Electron のコールバックは Angular の外側で発火するため、zone.run で UI 更新に乗せる。
        this.zone.run(() => {
          this.obdDataSubject.next(data);
        });
      });
    }
  }

  /**
   * OBDLiNKEX に接続する。
   * 成功後は監視ループを開始し、以後の OBD データをリアルタイム配信する。
   */
  async connect(portPath?: string, mode: MonitoringMode = 'obd2-standard'): Promise<{ success: boolean; message?: string }> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return { success: false, message: 'OBD API が利用できません' };
    }

    try {
      const result = await window.obdApi.connect(portPath);

      if (result.success) {
        // 接続成立後にリスナーを再設定して、最新の IPC 状態を受け取れるようにする。
        this.setupOBDListener();
        // main プロセス側で PID 取得ループを開始する。
        const monitoringResult = await window.obdApi.startMonitoring(mode);

        if (!monitoringResult?.success) {
          await window.obdApi.disconnect();
          this.isConnected = false;
          return {
            success: false,
            message: monitoringResult?.message ?? '監視開始に失敗しました',
          };
        }

        this.isConnected = true;
      }

      return result;
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  /**
    * OBDLiNKEX から切断する。
    * 先に監視を止めてから物理接続を閉じる。
   */
  async disconnect(): Promise<{ success: boolean; message?: string }> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return { success: false, message: 'OBD API が利用できません' };
    }

    try {
      await window.obdApi.stopMonitoring();
      const result = await window.obdApi.disconnect();

      if (result.success) {
        this.isConnected = false;
      }

      return result;
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  /**
    * 利用可能なシリアルポート一覧を取得する。
    * 画面上でポート選択 UI を作る場合の土台にもなる。
   */
  async listPorts(): Promise<SerialPortInfo[]> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return [];
    }

    try {
      return (await window.obdApi.listPorts()) as SerialPortInfo[];
    } catch (error) {
      console.error('ポート取得エラー:', error);
      return [];
    }
  }

  /**
   * 利用可能な監視モードを取得する。
   * 将来の ASC カプラー専用モードを UI から選択可能にするための API。
   */
  async getSupportedModes(): Promise<MonitoringMode[]> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return ['obd2-standard'];
    }

    try {
      const modes = await window.obdApi.getSupportedModes();
      return modes as MonitoringMode[];
    } catch {
      return ['obd2-standard'];
    }
  }

  async getVehicleProfile(): Promise<VehicleProfile> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return {
        vin: null,
        manufacturer: 'Unknown',
        model: 'Unknown',
        modelYear: 'Unknown',
        engineCode: 'Unknown',
        confidence: 'low',
      };
    }

    try {
      return await window.obdApi.getVehicleProfile();
    } catch {
      return {
        vin: null,
        manufacturer: 'Unknown',
        model: 'Unknown',
        modelYear: 'Unknown',
        engineCode: 'Unknown',
        confidence: 'low',
      };
    }
  }

  async getStoragePaths(): Promise<StoragePaths | null> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return null;
    }

    try {
      return await window.obdApi.getStoragePaths();
    } catch {
      return null;
    }
  }

  async getStorageOverview(): Promise<StorageOverview | null> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return null;
    }

    try {
      return await window.obdApi.getStorageOverview();
    } catch {
      return null;
    }
  }

  async setLogReservationMb(reservationMb: number): Promise<{ success: boolean; message?: string; reservationBytes?: number }> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return { success: false, message: 'OBD API が利用できません' };
    }

    try {
      return await window.obdApi.setLogReservationMb(reservationMb);
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  async reallocateReservation(): Promise<{ success: boolean; message?: string; reservationBytes?: number }> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return { success: false, message: 'OBD API が利用できません' };
    }

    try {
      return await window.obdApi.reallocateReservation();
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  async listIoMetrics(range: IoMetricRange): Promise<IoMetricSample[]> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return [];
    }

    try {
      return await window.obdApi.listIoMetrics(range);
    } catch {
      return [];
    }
  }

  async listKnownVehicles(): Promise<KnownVehicleRecord[]> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return [];
    }

    try {
      return await window.obdApi.listKnownVehicles();
    } catch {
      return [];
    }
  }

  async upsertKnownVehicle(payload: Omit<KnownVehicleRecord, 'id'>): Promise<{ success: boolean; message?: string }> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return { success: false, message: 'OBD API が利用できません' };
    }

    try {
      return await window.obdApi.upsertKnownVehicle(payload);
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  async deleteKnownVehicle(id: number): Promise<{ success: boolean; message?: string }> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return { success: false, message: 'OBD API が利用できません' };
    }

    try {
      return await window.obdApi.deleteKnownVehicle(id);
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  async listConnectionHistory(): Promise<ConnectionHistoryRecord[]> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return [];
    }

    try {
      return await window.obdApi.listConnectionHistory();
    } catch {
      return [];
    }
  }

  async listDriveLogs(limit = 240): Promise<DriveLogRecord[]> {
    const window = globalThis as any;

    if (!window.obdApi) {
      return [];
    }

    try {
      return await window.obdApi.listDriveLogs(limit);
    } catch {
      return [];
    }
  }

  onConnectionState(callback: (state: { connected: boolean; reason?: string }) => void): () => void {
    const window = globalThis as any;

    if (!window.obdApi || !window.obdApi.onConnectionState) {
      return () => {};
    }

    return window.obdApi.onConnectionState(callback);
  }

  /**
   * 接続状態を返す。
   * ボタン制御やステータス表示で使う。
   */
  isConnectedToOBD(): boolean {
    return this.isConnected;
  }

  /**
   * リアルタイムデータストリームを公開する。
   * コンポーネント側はこの Observable を購読するだけで最新値を受け取れる。
   */
  getOBDDataStream(): Observable<OBDData> {
    return this.obdData$;
  }

  ngOnDestroy() {
    if (this.unlistener) {
      // サービス破棄時に IPC 購読を解除する。
      this.unlistener();
    }
  }
}
