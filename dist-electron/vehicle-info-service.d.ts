export type IoMetricRange = '1m' | '1h' | 'all';
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
export interface IoMetricSample {
    sampledAt: string;
    sampledTimestampMs: number;
    driveLogDbSizeBytes: number;
    reservationBytes: number;
    reservationUsagePercent: number;
    writeDeltaBytes: number;
}
export interface VehicleIdentity {
    vin: string | null;
    manufacturer: string;
    model: string;
    modelYear: string;
    engineCode: string;
    confidence: 'high' | 'medium' | 'low';
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
export interface ConnectionStartPayload {
    vin: string | null;
    manufacturer: string;
    model: string;
    mode: string;
    portPath: string | null;
    connectedAt: string;
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
export interface DriveLogInput {
    vin: string;
    sampleTimestampMs: number;
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
}
export declare class VehicleInfoService {
    private readonly paths;
    private duckDb;
    private duckDbConnection;
    private duckDbInitPromise;
    private ioDuckDb;
    private ioDuckDbConnection;
    private ioDuckDbInitPromise;
    private configuredReservationMb;
    private lastDriveLogDbSizeBytes;
    private ioSampleTimer;
    private storageNotice;
    private isDisposing;
    private ioSampleFailureStreak;
    private readonly driveDbKind;
    private readonly ioDbKind;
    constructor();
    getStoragePaths(): StoragePaths;
    getStorageOverview(): StorageOverview;
    setLogReservationMb(reservationMb: number): {
        success: boolean;
        message?: string;
        reservationBytes?: number;
    };
    reallocateLogReservation(): {
        success: boolean;
        message?: string;
        reservationBytes?: number;
    };
    listIoMetricSamples(range: IoMetricRange): Promise<IoMetricSample[]>;
    dispose(): void;
    appendDriveLog(input: DriveLogInput): Promise<void>;
    listDriveLogs(limit?: number): Promise<DriveLogRecord[]>;
    listKnownVehicles(): KnownVehicleRecord[];
    upsertKnownVehicle(input: Omit<KnownVehicleRecord, 'id'>): {
        success: boolean;
        message?: string;
    };
    deleteKnownVehicle(id: number): {
        success: boolean;
        message?: string;
    };
    startConnectionHistory(payload: ConnectionStartPayload): number | null;
    finishConnectionHistory(connectionId: number, reason: string, disconnectedAt?: string): void;
    listConnectionHistory(limit?: number): ConnectionHistoryRecord[];
    resolveVehicleIdentity(vin: string | null): VehicleIdentity;
    private initializeStoragePaths;
    private findBaseStorageDirectory;
    private findOneDriveDirectory;
    private ensureMasterStore;
    private buildSeedRows;
    private ensureSummaryStore;
    private ensureDriveLogReservation;
    private ensureLogCapacity;
    private tryAutoExpandDbVolume;
    private deleteOldestDriveLogDay;
    private getCurrentDbVolumeUsedBytes;
    private ensureDuckDbReady;
    private getDuckDbConnection;
    private ensureDriveLogsColumns;
    private resetDuckDbConnection;
    private ensureIoDuckDbReady;
    private getIoDuckDbConnection;
    private startIoSampling;
    private recordIoMetricSampleSafely;
    private recordIoMetricSample;
    private resetIoDuckDbConnection;
    private normalizeDuckDbFile;
    private closeDuckDbConnection;
    private closeDuckDbDatabase;
    private isDuckDbConnectionError;
    private loadConfiguredReservationMb;
    private saveConfiguredReservationMb;
    private runDuckDb;
    private allDuckDb;
    private resetAndReconnect;
    private lookupIdentityByVin;
    private fallbackDecode;
    private decodeModelYear;
    private queryRows;
    private getFileSizeBytes;
    private getVolumeStats;
    private toPercent;
    private execute;
    private escapeSql;
    private toNumberLiteral;
    private toNullableNumber;
}
//# sourceMappingURL=vehicle-info-service.d.ts.map