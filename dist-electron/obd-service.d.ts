import { VehicleIdentity } from './vehicle-info-service';
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
export interface VehicleProfile extends VehicleIdentity {
}
export type MonitoringMode = 'obd2-standard' | 'asc-coupler';
export declare class OBDService {
    private port;
    private parser;
    private isMonitoring;
    private monitoringCallback;
    private dataCache;
    private lastEmittedData;
    private requestTimer;
    private requestInFlight;
    private pidCursor;
    private pendingRequest;
    private requestLoopGeneration;
    private readonly interRequestDelayMs;
    private readonly responseTimeoutMs;
    private readonly noDataGraceMs;
    private readonly profiles;
    private currentMode;
    private readonly ignoredPortPatterns;
    private cachedVin;
    private connectedPortPath;
    private noDataStreak;
    private lastSuccessfulRxAt;
    private connectionLostNotified;
    private onConnectionLostCallback;
    onConnectionLost(callback: (reason: 'port-lost' | 'ignition-off' | 'serial-error') => void): void;
    getConnectedPortPath(): string | null;
    /**
     * 利用可能なシリアルポートを列挙する。
     * ここでは接続は行わず、PCに見えている候補一覧だけを返す。
     * vendorId / productId / manufacturer を上位レイヤーで使えるようにしている。
     */
    listPorts(): Promise<{
        path: string;
        manufacturer: string;
        productId: string | undefined;
        vendorId: string | undefined;
    }[]>;
    /**
     * OBDLink EX デバイスを検出して接続する。
     * 引数でポートが指定されない場合は、自動検出ロジックで最も可能性が高いポートを選ぶ。
     */
    connect(portPath?: string): Promise<{
        success: boolean;
        path: string;
    }>;
    /**
      * 接続を切断する。
      * モニタリングループを止めてからポートを閉じることで、通信中断時の不整合を避ける。
     */
    disconnect(): Promise<void>;
    getVIN(): Promise<string | null>;
    private readVINWithRetry;
    /**
      * 車両データの定期取得を開始する。
      * 呼び出し元から渡されたコールバックへ、取得済みのOBDデータを一定周期で通知する。
     */
    startMonitoring(callback: (data: OBDData) => void, mode?: MonitoringMode): void;
    /**
     * 車両データの定期取得を停止する。
     * 次回ループの継続条件を false にするだけで、現在の送受信は自然終了させる。
     */
    stopMonitoring(): void;
    /**
     * 利用可能な監視モード一覧を返す。
     * UI から将来的にモード選択を可能にするための拡張ポイント。
     */
    getSupportedModes(): MonitoringMode[];
    /**
      * ELM327 初期化。
      * OBDLink EX は ELM327 互換なので、AT コマンドで通信挙動を整える。
     */
    private initializeOBD;
    /**
     * Mode 09 PID 02 からVINを取得する。
     * 返却形式が複数フレームに分かれるため、ASCII化した後に17桁へ正規化する。
     */
    private readVIN;
    /**
     * OBD コマンド送信。
     * 文字列末尾に CR を付けて ELM327 に 1 コマンドとして送る。
     */
    private sendCommand;
    /**
     * PID要求ループ（ラウンドロビン）。
     * ELM/OBDLink のコマンド完了後にだけ次の PID を要求する。
     */
    private startRequestLoop;
    private requestNextPid;
    private publishSnapshot;
    private stopTimers;
    private stopRequestTimer;
    /**
      * PID を 1つ要求する。
      * 例: 010C = RPM, 010D = 速度。
     */
    private requestPID;
    /**
     * シリアル受信した1行を解析する。
     * ヘッダー有無やスペース有無が混在しても、HEXバイト列として抽出して判定する。
     */
    private handleDataLine;
    private recordEcuResponseFailure;
    private completePendingRequest;
    private parseAtfTemperature;
    private decodeTemperaturePayload;
    private findPatternIndex;
    private notifyConnectionLost;
    /**
     * OBDLink EX に見えるポートを優先して選択する。
     * macOS の内部ポートを除外し、USBシリアルらしい候補や manufacturer 情報を加点して選ぶ。
     */
    private choosePreferredPort;
}
//# sourceMappingURL=obd-service.d.ts.map