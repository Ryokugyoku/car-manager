export interface OBDApi {
    connect: (portPath?: string) => Promise<{
        success: boolean;
        message?: string;
    }>;
    disconnect: () => Promise<{
        success: boolean;
        message?: string;
    }>;
    listPorts: () => Promise<Array<{
        path: string;
        manufacturer: string;
        productId?: string;
        vendorId?: string;
    }>>;
    startMonitoring: (mode?: string) => Promise<{
        success: boolean;
        message?: string;
    }>;
    stopMonitoring: () => Promise<{
        success: boolean;
        message?: string;
    }>;
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
    setLogReservationMb: (reservationMb: number) => Promise<{
        success: boolean;
        message?: string;
        reservationBytes?: number;
    }>;
    reallocateReservation: () => Promise<{
        success: boolean;
        message?: string;
        reservationBytes?: number;
    }>;
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
    }) => Promise<{
        success: boolean;
        message?: string;
    }>;
    deleteKnownVehicle: (id: number) => Promise<{
        success: boolean;
        message?: string;
    }>;
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
    onConnectionState: (callback: (state: {
        connected: boolean;
        reason?: string;
    }) => void) => () => void;
    onOBDData: (callback: (data: any) => void) => () => void;
}
declare global {
    interface Window {
        obdApi: OBDApi;
    }
}
//# sourceMappingURL=preload.d.ts.map