import { existsSync, mkdirSync, readdirSync, statSync, statfsSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const duckdb = require('duckdb');

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_LOG_RESERVATION_MB = 5120;
const DEFAULT_LOG_RESERVATION_BYTES = DEFAULT_LOG_RESERVATION_MB * BYTES_PER_MB;
const IO_LOG_DB_LIMIT_BYTES = 1024 * 1024 * 1024;
const VOLUME_WARNING_PERCENT = 80;
const VOLUME_CRITICAL_PERCENT = 92;
const WRITE_GUARD_BYTES = 4 * BYTES_PER_MB;
const AUTO_EXPAND_MIN_STEP_MB = 256;
const APP_FORCE_QUIT_REASON = 'app-force-quit';

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

interface IdentityMapRow {
  manufacturer: string;
  model: string;
  model_year: string;
  engine_code: string;
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

export class VehicleInfoService {
  private readonly paths: StoragePaths;
  private duckDb: any | null = null;
  private duckDbConnection: any | null = null;
  private duckDbInitPromise: Promise<void> | null = null;
  private ioDuckDb: any | null = null;
  private ioDuckDbConnection: any | null = null;
  private ioDuckDbInitPromise: Promise<void> | null = null;
  private configuredReservationMb = DEFAULT_LOG_RESERVATION_MB;
  private lastDriveLogDbSizeBytes = 0;
  private ioSampleTimer: NodeJS.Timeout | null = null;
  private storageNotice: string | null = null;
  private isDisposing = false;
  private ioSampleFailureStreak = 0;

  private readonly driveDbKind = 'drive' as const;
  private readonly ioDbKind = 'io' as const;

  constructor() {
    this.paths = this.initializeStoragePaths();
    this.ensureMasterStore();
    this.markIncompleteConnectionsAsForceQuit();
    this.configuredReservationMb = this.loadConfiguredReservationMb();
    this.ensureSummaryStore();
    this.startIoSampling();
  }

  getStoragePaths(): StoragePaths {
    return this.paths;
  }

  getStorageOverview(): StorageOverview {
    const volumeStats = this.getVolumeStats(this.paths.rootDir);
    const masterSize = this.getFileSizeBytes(this.paths.masterSqlitePath);
    const summarySize = this.getFileSizeBytes(this.paths.summaryDuckDbPath);
    const reservationAllocatedBytes = this.getFileSizeBytes(this.paths.driveLogReservationPath);
    const reservationBytes = this.configuredReservationMb * BYTES_PER_MB;
    const ioLogDbSizeBytes = this.getFileSizeBytes(this.paths.ioMetricsDuckDbPath);
    const dbVolumeUsedBytes = masterSize + summarySize + ioLogDbSizeBytes;
    const dbVolumeUsagePercent = this.toPercent(dbVolumeUsedBytes, reservationBytes);

    const totalBytes = volumeStats.totalBytes;
    const masterCapacity = totalBytes > 0 ? totalBytes : Math.max(masterSize, 1);
    const logCapacity = reservationBytes > 0 ? reservationBytes : DEFAULT_LOG_RESERVATION_BYTES;
    const reservationUsagePercent = this.toPercent(summarySize, logCapacity);
    const ioLogDbUsagePercent = this.toPercent(ioLogDbSizeBytes, IO_LOG_DB_LIMIT_BYTES);

    return {
      rootDir: this.paths.rootDir,
      dbVolumeDir: this.paths.dbVolumeDir,
      totalBytes,
      freeBytes: volumeStats.freeBytes,
      dbVolumeSizeBytes: logCapacity,
      dbVolumeUsedBytes,
      dbVolumeUsagePercent,
      dbVolumeWarning: dbVolumeUsagePercent >= VOLUME_WARNING_PERCENT,
      dbVolumeCritical: dbVolumeUsagePercent >= VOLUME_CRITICAL_PERCENT,
      dbVolumeAutoCleanupPolicy: '警告を無視して容量不足が継続した場合、最古日付のログを1日分削除して領域を確保します。',
      dbVolumeNotice: this.storageNotice,
      reservationPath: this.paths.driveLogReservationPath,
      reservationConfiguredMb: this.configuredReservationMb,
      reservationAllocatedBytes,
      reservationBytes: logCapacity,
      reservationUsagePercent,
      reservationWarning: dbVolumeUsagePercent >= VOLUME_WARNING_PERCENT,
      ioLogDbPath: this.paths.ioMetricsDuckDbPath,
      ioLogDbSizeBytes,
      ioLogDbLimitBytes: IO_LOG_DB_LIMIT_BYTES,
      ioLogDbUsagePercent,
      ioLogDbLimitExceeded: ioLogDbSizeBytes > IO_LOG_DB_LIMIT_BYTES,
      databases: [
        {
          label: 'Master DB (SQLite)',
          path: this.paths.masterSqlitePath,
          sizeBytes: masterSize,
          capacityBytes: masterCapacity,
          ioPercent: this.toPercent(masterSize, masterCapacity),
        },
        {
          label: 'Drive Logs DB (DuckDB)',
          path: this.paths.summaryDuckDbPath,
          sizeBytes: summarySize,
          capacityBytes: logCapacity,
          ioPercent: reservationUsagePercent,
        },
      ],
    };
  }

  setLogReservationMb(reservationMb: number): { success: boolean; message?: string; reservationBytes?: number } {
    const normalizedMb = Math.floor(Number(reservationMb));
    if (!Number.isFinite(normalizedMb) || normalizedMb < 128) {
      return { success: false, message: 'Reservation must be at least 128 MB.' };
    }

    const reservationBytes = normalizedMb * BYTES_PER_MB;
    const reserveResult = this.ensureDriveLogReservation(reservationBytes);
    if (!reserveResult.success) {
      return { success: false, message: reserveResult.message ?? 'Failed to reserve disk space.' };
    }

    this.configuredReservationMb = normalizedMb;
    this.saveConfiguredReservationMb(normalizedMb);
    return { success: true, reservationBytes };
  }

  reallocateLogReservation(): { success: boolean; message?: string; reservationBytes?: number } {
    const reservationBytes = this.configuredReservationMb * BYTES_PER_MB;
    const reserveResult = this.ensureDriveLogReservation(reservationBytes);
    if (!reserveResult.success) {
      return { success: false, message: reserveResult.message ?? 'Failed to reserve disk space.' };
    }

    return { success: true, reservationBytes };
  }

  async listIoMetricSamples(range: IoMetricRange): Promise<IoMetricSample[]> {
    await this.ensureIoDuckDbReady();
    const now = Date.now();
    let whereSql = '';
    let limitSql = '';

    if (range === '1m') {
      whereSql = `WHERE sampled_timestamp_ms >= ${now - 60_000}`;
      limitSql = 'LIMIT 60';
    } else if (range === '1h') {
      whereSql = `WHERE sampled_timestamp_ms >= ${now - 3_600_000}`;
      limitSql = 'LIMIT 3600';
    }

    const sql = `
SELECT sampled_at, sampled_timestamp_ms, drive_log_db_size_bytes, reservation_bytes, reservation_usage_percent, write_delta_bytes
FROM io_metrics
${whereSql}
ORDER BY sampled_timestamp_ms DESC
${limitSql};
`;

    const rows = await this.allDuckDb(sql, this.getIoDuckDbConnection(), this.ioDbKind);
    return rows
      .map((row) => ({
        sampledAt: String(row.sampled_at ?? ''),
        sampledTimestampMs: Number(row.sampled_timestamp_ms ?? 0),
        driveLogDbSizeBytes: Number(row.drive_log_db_size_bytes ?? 0),
        reservationBytes: Number(row.reservation_bytes ?? 0),
        reservationUsagePercent: Number(row.reservation_usage_percent ?? 0),
        writeDeltaBytes: Number(row.write_delta_bytes ?? 0),
      }))
      .reverse();
  }

  dispose() {
    this.isDisposing = true;

    if (this.ioSampleTimer) {
      clearInterval(this.ioSampleTimer);
      this.ioSampleTimer = null;
    }

    this.closeDuckDbConnection(this.ioDuckDbConnection);
    this.closeDuckDbConnection(this.duckDbConnection);
    this.closeDuckDbDatabase(this.ioDuckDb);
    this.closeDuckDbDatabase(this.duckDb);
    this.ioDuckDb = null;
    this.duckDb = null;
    this.ioDuckDbConnection = null;
    this.duckDbConnection = null;
    this.ioDuckDbInitPromise = null;
    this.duckDbInitPromise = null;
  }

  async appendDriveLog(input: DriveLogInput): Promise<void> {
    if (!input.vin) {
      return;
    }

    await this.ensureLogCapacity(WRITE_GUARD_BYTES);

    await this.ensureDuckDbReady();
    const connection = this.getDuckDbConnection();
    const sampleAt = new Date(input.sampleTimestampMs).toISOString();

    const sql = `
INSERT INTO drive_logs (
  vin, sample_timestamp_ms, sample_at, manufacturer, model, mode, port_path,
  speed, rpm, engine_temp, engine_oil_temp, atf_temp, fuel_level, engine_load,
  throttle_position, timing_advance, intake_air_temp, manifold_pressure, maf, control_module_voltage
) VALUES (
  '${this.escapeSql(input.vin)}',
  ${Number(input.sampleTimestampMs)},
  '${this.escapeSql(sampleAt)}',
  '${this.escapeSql(input.manufacturer)}',
  '${this.escapeSql(input.model)}',
  '${this.escapeSql(input.mode)}',
  ${input.portPath ? `'${this.escapeSql(input.portPath)}'` : 'NULL'},
  ${this.toNumberLiteral(input.speed)},
  ${this.toNumberLiteral(input.rpm)},
  ${this.toNumberLiteral(input.engineTemp)},
  ${this.toNumberLiteral(input.engineOilTemp)},
  ${this.toNumberLiteral(input.atfTemp)},
  ${this.toNumberLiteral(input.fuelLevel)},
  ${this.toNumberLiteral(input.engineLoad)},
  ${this.toNumberLiteral(input.throttlePosition)},
  ${this.toNumberLiteral(input.timingAdvance)},
  ${this.toNumberLiteral(input.intakeAirTemp)},
  ${this.toNumberLiteral(input.manifoldPressure)},
  ${this.toNumberLiteral(input.maf)},
  ${this.toNumberLiteral(input.controlModuleVoltage)}
)
ON CONFLICT(vin, sample_timestamp_ms) DO UPDATE SET
  sample_at=excluded.sample_at,
  manufacturer=excluded.manufacturer,
  model=excluded.model,
  mode=excluded.mode,
  port_path=excluded.port_path,
  speed=excluded.speed,
  rpm=excluded.rpm,
  engine_temp=excluded.engine_temp,
  engine_oil_temp=excluded.engine_oil_temp,
  atf_temp=excluded.atf_temp,
  fuel_level=excluded.fuel_level,
  engine_load=excluded.engine_load,
  throttle_position=excluded.throttle_position,
  timing_advance=excluded.timing_advance,
  intake_air_temp=excluded.intake_air_temp,
  manifold_pressure=excluded.manifold_pressure,
  maf=excluded.maf,
  control_module_voltage=excluded.control_module_voltage;
`;

    try {
      await this.runDuckDb(sql, connection);
    } catch (error) {
      if (!this.isDuckDbConnectionError(error)) {
        throw error;
      }

      // 接続ハンドルが失効していた場合は再生成して1回だけ再試行する。
      this.resetDuckDbConnection();
      await this.ensureDuckDbReady();
      await this.runDuckDb(sql, this.getDuckDbConnection());
    }

    // 書き込み後の使用量が閾値を超えた場合、次回 overview で表示できるよう通知を保持する。
    const usagePercent = this.toPercent(this.getCurrentDbVolumeUsedBytes(), this.configuredReservationMb * BYTES_PER_MB);
    if (usagePercent >= VOLUME_WARNING_PERCENT) {
      this.storageNotice = `DB専用ボリューム使用率 ${usagePercent.toFixed(1)}%: 容量を拡張するか、Storage画面で設定を見直してください。`;
    }
  }

  async listDriveLogs(limit?: number): Promise<DriveLogRecord[]> {
    await this.ensureDuckDbReady();
    const limitClause = Number.isFinite(limit) && Number(limit) > 0
      ? `LIMIT ${Math.max(1, Math.floor(Number(limit)))}`
      : '';
    const sql = `
SELECT vin, sample_timestamp_ms, sample_at, manufacturer, model, mode, port_path,
       speed, rpm, engine_temp, engine_oil_temp, atf_temp, fuel_level, engine_load,
       throttle_position, timing_advance, intake_air_temp, manifold_pressure, maf, control_module_voltage
FROM drive_logs
ORDER BY sample_timestamp_ms DESC
${limitClause};
`;

    const rows = await this.allDuckDb(sql, this.getDuckDbConnection());
    return rows.map((row) => ({
      vin: String(row.vin ?? ''),
      sampleTimestampMs: Number(row.sample_timestamp_ms ?? 0),
      sampleAt: String(row.sample_at ?? ''),
      manufacturer: String(row.manufacturer ?? 'Unknown'),
      model: String(row.model ?? 'Unknown'),
      mode: String(row.mode ?? 'unknown'),
      portPath: row.port_path ?? null,
      speed: this.toNullableNumber(row.speed),
      rpm: this.toNullableNumber(row.rpm),
      engineTemp: this.toNullableNumber(row.engine_temp),
      engineOilTemp: this.toNullableNumber(row.engine_oil_temp),
      atfTemp: this.toNullableNumber(row.atf_temp),
      fuelLevel: this.toNullableNumber(row.fuel_level),
      engineLoad: this.toNullableNumber(row.engine_load),
      throttlePosition: this.toNullableNumber(row.throttle_position),
      timingAdvance: this.toNullableNumber(row.timing_advance),
      intakeAirTemp: this.toNullableNumber(row.intake_air_temp),
      manifoldPressure: this.toNullableNumber(row.manifold_pressure),
      maf: this.toNullableNumber(row.maf),
      controlModuleVoltage: this.toNullableNumber(row.control_module_voltage),
    }));
  }

  listKnownVehicles(): KnownVehicleRecord[] {
    const sql = `
SELECT id, vin_pattern, manufacturer, model, model_year, engine_code
FROM vehicle_identity_map
ORDER BY manufacturer, model, model_year;
`;

    const result = this.queryRows(sql);
    return result.map((row) => ({
      id: Number(row[0] ?? 0),
      vinPattern: row[1] ?? '',
      manufacturer: row[2] ?? '',
      model: row[3] ?? '',
      modelYear: row[4] ?? '',
      engineCode: row[5] ?? '',
    }));
  }

  upsertKnownVehicle(input: Omit<KnownVehicleRecord, 'id'>): { success: boolean; message?: string } {
    const sql = `
INSERT INTO vehicle_identity_map (vin_pattern, manufacturer, model, model_year, engine_code)
VALUES ('${this.escapeSql(input.vinPattern)}', '${this.escapeSql(input.manufacturer)}', '${this.escapeSql(input.model)}', '${this.escapeSql(input.modelYear)}', '${this.escapeSql(input.engineCode)}')
ON CONFLICT(vin_pattern) DO UPDATE SET
  manufacturer=excluded.manufacturer,
  model=excluded.model,
  model_year=excluded.model_year,
  engine_code=excluded.engine_code;
`;

    const result = this.execute(sql);
    if (!result.ok) {
      return { success: false, message: result.stderr || 'failed to upsert vehicle map' };
    }

    return { success: true };
  }

  deleteKnownVehicle(id: number): { success: boolean; message?: string } {
    const sql = `DELETE FROM vehicle_identity_map WHERE id=${Number(id)};`;
    const result = this.execute(sql);
    if (!result.ok) {
      return { success: false, message: result.stderr || 'failed to delete vehicle map' };
    }
    return { success: true };
  }

  startConnectionHistory(payload: ConnectionStartPayload): number | null {
    const vinValue = payload.vin ? `'${this.escapeSql(payload.vin)}'` : 'NULL';
    const portValue = payload.portPath ? `'${this.escapeSql(payload.portPath)}'` : 'NULL';
    const sql = `
INSERT INTO connection_history (
  vin, manufacturer, model, mode, port_path, connected_at
) VALUES (
  ${vinValue},
  '${this.escapeSql(payload.manufacturer)}',
  '${this.escapeSql(payload.model)}',
  '${this.escapeSql(payload.mode)}',
  ${portValue},
  '${this.escapeSql(payload.connectedAt)}'
);
SELECT last_insert_rowid();
`;

    const result = this.execute(sql);
    if (!result.ok) {
      return null;
    }

    const idLine = result.stdout
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .pop();
    const id = Number(idLine ?? 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  finishConnectionHistory(connectionId: number, reason: string, disconnectedAt = new Date().toISOString()) {
    const sql = `
UPDATE connection_history
SET disconnected_at='${this.escapeSql(disconnectedAt)}',
    disconnect_reason='${this.escapeSql(reason)}'
WHERE id=${Number(connectionId)} AND disconnected_at IS NULL;
`;
    this.execute(sql);
  }

  /**
   * 前回起動時の未完了レコードは、正常な切断処理を通らずにプロセスが
   * 終了した接続として扱う。現在の接続が作られる前の起動時にのみ呼ぶ。
   * 実際の終了時刻は確定できないため disconnected_at は補完しない。
   */
  private markIncompleteConnectionsAsForceQuit() {
    const sql = `
UPDATE connection_history
SET disconnect_reason='${APP_FORCE_QUIT_REASON}'
WHERE disconnected_at IS NULL
  AND (disconnect_reason IS NULL OR disconnect_reason = '');
`;
    this.execute(sql);
  }

  listConnectionHistory(limit = 300): ConnectionHistoryRecord[] {
    const boundedLimit = Math.max(1, Math.min(2000, Number(limit) || 300));
    const sql = `
SELECT id, vin, manufacturer, model, mode, port_path, connected_at, disconnected_at, disconnect_reason
FROM connection_history
ORDER BY connected_at DESC
LIMIT ${boundedLimit};
`;

    const result = this.queryRows(sql);
    return result.map((row) => ({
      id: Number(row[0] ?? 0),
      vin: row[1] || null,
      manufacturer: row[2] ?? 'Unknown',
      model: row[3] ?? 'Unknown',
      mode: row[4] ?? 'unknown',
      portPath: row[5] || null,
      connectedAt: row[6] ?? '',
      disconnectedAt: row[7] || null,
      disconnectReason: row[8] || null,
    }));
  }

  resolveVehicleIdentity(vin: string | null): VehicleIdentity {
    if (!vin) {
      return {
        vin: null,
        manufacturer: 'Unknown',
        model: 'Unknown',
        modelYear: 'Unknown',
        engineCode: 'Unknown',
        confidence: 'low',
      };
    }

    const mapped = this.lookupIdentityByVin(vin);
    if (mapped) {
      return {
        vin,
        manufacturer: mapped.manufacturer,
        model: mapped.model,
        modelYear: mapped.model_year,
        engineCode: mapped.engine_code,
        confidence: 'high',
      };
    }

    return this.fallbackDecode(vin);
  }

  private initializeStoragePaths(): StoragePaths {
    const rootDir = join(this.findBaseStorageDirectory(), 'CarManager');
    const dbVolumeDir = join(rootDir, 'db-volume');
    mkdirSync(rootDir, { recursive: true });
    mkdirSync(dbVolumeDir, { recursive: true });

    return {
      rootDir,
      dbVolumeDir,
      masterSqlitePath: join(dbVolumeDir, 'master.sqlite'),
      summaryDuckDbPath: join(dbVolumeDir, 'drive_logs.duckdb'),
      driveLogReservationPath: join(dbVolumeDir, 'drive_logs.reserve'),
      ioMetricsDuckDbPath: join(dbVolumeDir, 'io_metrics.duckdb'),
    };
  }

  private findBaseStorageDirectory(): string {
    const home = homedir();
    const currentPlatform = platform();

    // 将来 iOS 実装時の保存先方針。Electron 本体は iOS で動かないが、
    // 共通仕様として iCloud Documents 配下を優先させる。
    if (process.env.CARMANAGER_TARGET_PLATFORM === 'ios') {
      const iCloudDocuments = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents');
      if (existsSync(iCloudDocuments)) {
        return iCloudDocuments;
      }
    }

    // OneDrive 配下を最優先にする。
    const oneDriveDir = this.findOneDriveDirectory(home);
    if (oneDriveDir) {
      return oneDriveDir;
    }

    if (currentPlatform === 'win32' || currentPlatform === 'darwin' || currentPlatform === 'linux') {
      return join(home, 'Documents');
    }

    return home;
  }

  private findOneDriveDirectory(home: string): string | null {
    const directCandidates = [
      join(home, 'OneDrive'),
      join(home, 'OneDrive - Personal'),
      join(home, 'OneDrive - Business'),
    ];

    for (const candidate of directCandidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    try {
      const children = readdirSync(home, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith('onedrive'))
        .map((entry) => join(home, entry.name))
        .sort();

      return children[0] ?? null;
    } catch {
      return null;
    }
  }

  private ensureMasterStore() {
    const schemaSql = `
CREATE TABLE IF NOT EXISTS vehicle_identity_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin_pattern TEXT NOT NULL UNIQUE,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  model_year TEXT NOT NULL,
  engine_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connection_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin TEXT,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  port_path TEXT,
  connected_at TEXT NOT NULL,
  disconnected_at TEXT,
  disconnect_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_connection_history_connected_at
ON connection_history(connected_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_history_vin
ON connection_history(vin);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('log_reservation_mb', '${DEFAULT_LOG_RESERVATION_MB}');

`;

    const seedRows = this.buildSeedRows();
    const seedSql = seedRows
      .map((row) => {
        return `INSERT OR IGNORE INTO vehicle_identity_map (vin_pattern, manufacturer, model, model_year, engine_code) VALUES ('${this.escapeSql(row.vinPattern)}', '${this.escapeSql(row.manufacturer)}', '${this.escapeSql(row.model)}', '${this.escapeSql(row.modelYear)}', '${this.escapeSql(row.engineCode)}');`;
      })
      .join('\n');

    const fullSql = `${schemaSql}\n${seedSql}`;

    const sqliteResult = this.execute(fullSql);

    // sqlite3 コマンドが利用できない環境向けに、最低限の初期化SQLをファイルへ残す。
    if (!sqliteResult.ok) {
      const fallbackSchemaPath = join(this.paths.rootDir, 'master-schema.sql');
      if (!existsSync(fallbackSchemaPath)) {
        writeFileSync(fallbackSchemaPath, fullSql, { encoding: 'utf8' });
      }
    }
  }

  private buildSeedRows(): Array<{ vinPattern: string; manufacturer: string; model: string; modelYear: string; engineCode: string }> {
    return [
      { vinPattern: 'JF1ZN6%', manufacturer: 'SUBARU', model: 'BRZ (ZN6)', modelYear: '2012-2020', engineCode: 'FA20' },
      { vinPattern: 'JF1ZD8%', manufacturer: 'SUBARU', model: 'BRZ (ZD8)', modelYear: '2021-', engineCode: 'FA24' },
      { vinPattern: 'JF1VA%', manufacturer: 'SUBARU', model: 'WRX STI', modelYear: '2014-2021', engineCode: 'EJ20' },
      { vinPattern: 'JF1VB%', manufacturer: 'SUBARU', model: 'WRX S4', modelYear: '2014-2021', engineCode: 'FA20F' },
      { vinPattern: 'JF1VB%', manufacturer: 'SUBARU', model: 'WRX', modelYear: '2022-', engineCode: 'FA24F' },
      { vinPattern: 'JF2SK%', manufacturer: 'SUBARU', model: 'Forester', modelYear: '2018-', engineCode: 'FB25' },
      { vinPattern: 'JF2BT%', manufacturer: 'SUBARU', model: 'Outback', modelYear: '2020-', engineCode: 'CB18' },
      { vinPattern: 'JTDKARFP%', manufacturer: 'TOYOTA', model: 'Prius', modelYear: '2016-', engineCode: '2ZR-FXE' },
      { vinPattern: 'JTDBR32E%', manufacturer: 'TOYOTA', model: 'GR86', modelYear: '2021-', engineCode: 'FA24' },
      { vinPattern: 'JTNK4MBE%', manufacturer: 'TOYOTA', model: 'Corolla', modelYear: '2018-', engineCode: 'M20A' },
      { vinPattern: 'JTMAB3FV%', manufacturer: 'TOYOTA', model: 'RAV4', modelYear: '2019-', engineCode: 'A25A' },
      { vinPattern: 'JTEBU5JR%', manufacturer: 'TOYOTA', model: 'Land Cruiser Prado', modelYear: '2009-2023', engineCode: '1GD-FTV' },
      { vinPattern: 'JHMGK5%', manufacturer: 'HONDA', model: 'Fit/Jazz', modelYear: '2013-', engineCode: 'L15B' },
      { vinPattern: 'JHMFC1%', manufacturer: 'HONDA', model: 'Civic', modelYear: '2016-', engineCode: 'L15B' },
      { vinPattern: 'JHMED6%', manufacturer: 'HONDA', model: 'Civic Hybrid', modelYear: '2022-', engineCode: 'LFC-H4' },
      { vinPattern: '5J6RW1%', manufacturer: 'HONDA', model: 'CR-V', modelYear: '2017-', engineCode: 'L15B7' },
      { vinPattern: 'JN1AZ4%', manufacturer: 'NISSAN', model: 'Fairlady Z', modelYear: '2008-2020', engineCode: 'VQ37VHR' },
      { vinPattern: 'JN1CZ4%', manufacturer: 'NISSAN', model: 'Fairlady Z (RZ34)', modelYear: '2022-', engineCode: 'VR30DDTT' },
      { vinPattern: 'JN1CV6%', manufacturer: 'NISSAN', model: 'Skyline', modelYear: '2014-', engineCode: 'VR30DDTT' },
      { vinPattern: 'JN8AT3%', manufacturer: 'NISSAN', model: 'X-Trail', modelYear: '2013-', engineCode: 'MR20DD' },
      { vinPattern: 'JM1ND%', manufacturer: 'MAZDA', model: 'Roadster/MX-5', modelYear: '2015-', engineCode: 'PE-VPR' },
      { vinPattern: 'JM3KF%', manufacturer: 'MAZDA', model: 'CX-5', modelYear: '2017-', engineCode: 'PY-VPS' },
      { vinPattern: 'JM6BP%', manufacturer: 'MAZDA', model: 'Mazda3', modelYear: '2019-', engineCode: 'PE-VPS' },
      { vinPattern: 'JS2YB%', manufacturer: 'SUZUKI', model: 'Swift', modelYear: '2017-', engineCode: 'K12C' },
      { vinPattern: 'JSAAZC%', manufacturer: 'SUZUKI', model: 'Jimny', modelYear: '2018-', engineCode: 'K15B' },
      { vinPattern: 'ML32%', manufacturer: 'MITSUBISHI', model: 'Mirage', modelYear: '2012-', engineCode: '3A92' },
      { vinPattern: 'JMBXT%', manufacturer: 'MITSUBISHI', model: 'Outlander', modelYear: '2012-', engineCode: '4B12' },
      { vinPattern: 'SALWA2%', manufacturer: 'LAND ROVER', model: 'Range Rover Sport', modelYear: '2013-', engineCode: 'AJ133' },
      { vinPattern: 'WBA%', manufacturer: 'BMW', model: 'BMW (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'WBS%', manufacturer: 'BMW', model: 'BMW M (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'WDD%', manufacturer: 'MERCEDES-BENZ', model: 'Mercedes-Benz (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'WVW%', manufacturer: 'VOLKSWAGEN', model: 'Volkswagen (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'WAU%', manufacturer: 'AUDI', model: 'Audi (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'WP0%', manufacturer: 'PORSCHE', model: 'Porsche (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1HG%', manufacturer: 'HONDA', model: 'Honda (US Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '2HG%', manufacturer: 'HONDA', model: 'Honda (Canada Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1N4%', manufacturer: 'NISSAN', model: 'Nissan (US Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '3N1%', manufacturer: 'NISSAN', model: 'Nissan (Mexico Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1FA%', manufacturer: 'FORD', model: 'Ford (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1FTE%', manufacturer: 'FORD', model: 'F-Series', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1G1%', manufacturer: 'CHEVROLET', model: 'Chevrolet (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1C4%', manufacturer: 'JEEP', model: 'Jeep (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '1C6%', manufacturer: 'RAM', model: 'Ram (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '5YJ%', manufacturer: 'TESLA', model: 'Tesla (Generic)', modelYear: 'Unknown', engineCode: 'EV' },
      { vinPattern: 'KMH%', manufacturer: 'HYUNDAI', model: 'Hyundai (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'KNA%', manufacturer: 'KIA', model: 'Kia (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'KNM%', manufacturer: 'RENAULT SAMSUNG', model: 'Renault Samsung (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'VF1%', manufacturer: 'RENAULT', model: 'Renault (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'VF3%', manufacturer: 'PEUGEOT', model: 'Peugeot (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'VF7%', manufacturer: 'CITROEN', model: 'Citroen (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'ZFA%', manufacturer: 'FIAT', model: 'Fiat (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'ZAR%', manufacturer: 'ALFA ROMEO', model: 'Alfa Romeo (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'YS3%', manufacturer: 'SAAB', model: 'Saab (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'YV1%', manufacturer: 'VOLVO', model: 'Volvo (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'YV4%', manufacturer: 'VOLVO', model: 'Volvo SUV (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'TRU%', manufacturer: 'AUDI', model: 'Audi Hungary (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'JH4%', manufacturer: 'ACURA', model: 'Acura (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '19U%', manufacturer: 'ACURA', model: 'Acura (US Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '4T1%', manufacturer: 'TOYOTA', model: 'Toyota (US Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '2T1%', manufacturer: 'TOYOTA', model: 'Toyota (Canada Built)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: '3VW%', manufacturer: 'VOLKSWAGEN', model: 'Volkswagen Mexico (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'LSV%', manufacturer: 'TESLA/SAIC JV', model: 'China Built (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
      { vinPattern: 'LHG%', manufacturer: 'HONDA CHINA', model: 'Honda China (Generic)', modelYear: 'Unknown', engineCode: 'Unknown' },
    ];
  }

  private ensureSummaryStore() {
    const reservationBytes = this.configuredReservationMb * BYTES_PER_MB;
    const reserveResult = this.ensureDriveLogReservation(reservationBytes);
    if (!reserveResult.success) {
      console.error('Drive log reservation failed:', reserveResult.message ?? 'unknown error');
    }

    // DuckDBファイルを0byteで事前作成すると接続失敗するため、存在していても空なら削除する。
    this.normalizeDuckDbFile(this.paths.summaryDuckDbPath);
    this.normalizeDuckDbFile(this.paths.ioMetricsDuckDbPath);

    void this.ensureDuckDbReady().catch((error) => {
      console.error('DuckDB init failed during startup:', error);
    });

    void this.ensureIoDuckDbReady().catch((error) => {
      console.error('I/O metrics DB init failed during startup:', error);
    });
  }

  private ensureDriveLogReservation(reservationBytes: number): { success: boolean; message?: string } {
    const reservePath = this.paths.driveLogReservationPath;
    const reservationMb = Math.max(1, Math.floor(reservationBytes / BYTES_PER_MB));

    try {
      if (existsSync(reservePath)) {
        const currentSize = statSync(reservePath).size;
        if (currentSize === reservationBytes) {
          return { success: true };
        }

        unlinkSync(reservePath);
      }
    } catch (error) {
      return { success: false, message: `Failed to recreate reservation file: ${String(error)}` };
    }

    const reserveSizeArg = `${reservationMb}m`;
    const result = spawnSync('mkfile', [reserveSizeArg, reservePath], { encoding: 'utf8' });

    if (result.status !== 0 || !existsSync(reservePath) || this.getFileSizeBytes(reservePath) !== reservationBytes) {
      return {
        success: false,
        message: (result.stderr || result.error?.message || `mkfile failed for ${reserveSizeArg}`).trim(),
      };
    }

    return { success: true };
  }

  private async ensureLogCapacity(requiredBytes: number): Promise<void> {
    const reservationBytes = this.configuredReservationMb * BYTES_PER_MB;
    const usedBytes = this.getCurrentDbVolumeUsedBytes();
    if (usedBytes + requiredBytes <= reservationBytes) {
      return;
    }

    const expanded = this.tryAutoExpandDbVolume(usedBytes + requiredBytes);
    if (expanded.success) {
      this.storageNotice = expanded.message ?? 'DB専用ボリュームを自動拡張しました。';
      return;
    }

    const deleted = await this.deleteOldestDriveLogDay();
    if (deleted.deletedRows > 0) {
      this.storageNotice = `容量逼迫のため ${deleted.deletedDay ?? '最古日付'} のログを1日分(${deleted.deletedRows}件)削除しました。`;
      const refreshedUsedBytes = this.getCurrentDbVolumeUsedBytes();
      if (refreshedUsedBytes + requiredBytes <= this.configuredReservationMb * BYTES_PER_MB) {
        return;
      }
    }

    throw new Error('DB専用ボリュームの容量が不足しています。Storage画面でボリュームサイズを拡張してください。');
  }

  private tryAutoExpandDbVolume(requiredTotalBytes: number): { success: boolean; message?: string } {
    const currentMb = this.configuredReservationMb;
    const requiredMb = Math.ceil(requiredTotalBytes / BYTES_PER_MB);
    const expandedMb = Math.max(currentMb + AUTO_EXPAND_MIN_STEP_MB, Math.ceil(requiredMb * 1.15));

    if (expandedMb <= currentMb) {
      return { success: false, message: 'No volume expansion needed.' };
    }

    const reserveResult = this.ensureDriveLogReservation(expandedMb * BYTES_PER_MB);
    if (!reserveResult.success) {
      return { success: false, message: reserveResult.message ?? 'Failed to auto expand DB volume.' };
    }

    this.configuredReservationMb = expandedMb;
    this.saveConfiguredReservationMb(expandedMb);
    return { success: true, message: `DB専用ボリュームを ${expandedMb} MB に自動拡張しました。` };
  }

  private async deleteOldestDriveLogDay(): Promise<{ deletedRows: number; deletedDay: string | null }> {
    await this.ensureDuckDbReady();
    const connection = this.getDuckDbConnection();
    const oldestDayRows = await this.allDuckDb(
      `
SELECT SUBSTR(sample_at, 1, 10) AS day_key
FROM drive_logs
WHERE sample_at IS NOT NULL
ORDER BY sample_timestamp_ms ASC
LIMIT 1;
`,
      connection,
    );

    const oldestDay = String(oldestDayRows[0]?.day_key ?? '').trim();
    if (!oldestDay) {
      return { deletedRows: 0, deletedDay: null };
    }

    const escapedDay = this.escapeSql(oldestDay);
    const countRows = await this.allDuckDb(
      `SELECT COUNT(*) AS cnt FROM drive_logs WHERE SUBSTR(sample_at, 1, 10)='${escapedDay}';`,
      connection,
    );
    const deletedRows = Number(countRows[0]?.cnt ?? 0);

    await this.runDuckDb(`DELETE FROM drive_logs WHERE SUBSTR(sample_at, 1, 10)='${escapedDay}';`, connection, this.driveDbKind);
    await this.runDuckDb('CHECKPOINT;', connection, this.driveDbKind);

    return {
      deletedRows,
      deletedDay: oldestDay,
    };
  }

  private getCurrentDbVolumeUsedBytes(): number {
    return (
      this.getFileSizeBytes(this.paths.masterSqlitePath)
      + this.getFileSizeBytes(this.paths.summaryDuckDbPath)
      + this.getFileSizeBytes(this.paths.ioMetricsDuckDbPath)
    );
  }

  private async ensureDuckDbReady(): Promise<void> {
    if (!this.duckDbInitPromise) {
      this.duckDbInitPromise = (async () => {
        const connection = this.getDuckDbConnection();
        await this.runDuckDb(`
CREATE TABLE IF NOT EXISTS drive_logs (
  vin TEXT NOT NULL,
  sample_timestamp_ms BIGINT NOT NULL,
  sample_at TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  port_path TEXT,
  speed DOUBLE,
  rpm DOUBLE,
  engine_temp DOUBLE,
  engine_oil_temp DOUBLE,
  atf_temp DOUBLE,
  fuel_level DOUBLE,
  engine_load DOUBLE,
  throttle_position DOUBLE,
  timing_advance DOUBLE,
  intake_air_temp DOUBLE,
  manifold_pressure DOUBLE,
  maf DOUBLE,
  control_module_voltage DOUBLE,
  PRIMARY KEY (vin, sample_timestamp_ms)
);
`, connection);

        await this.ensureDriveLogsColumns(connection);
      })();
    }

    try {
      await this.duckDbInitPromise;
    } catch (error) {
      // 初期化に失敗した接続ハンドルは再利用せず、次回アクセスで再作成する。
      this.closeDuckDbConnection(this.duckDbConnection);
      this.closeDuckDbDatabase(this.duckDb);
      this.duckDbInitPromise = null;
      this.duckDb = null;
      this.duckDbConnection = null;
      throw error;
    }
  }

  private getDuckDbConnection() {
    this.normalizeDuckDbFile(this.paths.summaryDuckDbPath);

    if (!this.duckDbConnection) {
      this.duckDb = new duckdb.Database(this.paths.summaryDuckDbPath);
      this.duckDbConnection = this.duckDb.connect();
    }

    return this.duckDbConnection;
  }

  private async ensureDriveLogsColumns(connection: any) {
    const columns = await this.allDuckDb("PRAGMA table_info('drive_logs');", connection, this.driveDbKind);
    const existing = new Set(columns.map((row) => String(row.name ?? '').toLowerCase()));

    const requiredColumns: Array<{ name: string; type: string }> = [
      { name: 'manufacturer', type: 'TEXT' },
      { name: 'model', type: 'TEXT' },
      { name: 'mode', type: 'TEXT' },
      { name: 'port_path', type: 'TEXT' },
      { name: 'speed', type: 'DOUBLE' },
      { name: 'rpm', type: 'DOUBLE' },
      { name: 'engine_temp', type: 'DOUBLE' },
      { name: 'engine_oil_temp', type: 'DOUBLE' },
      { name: 'atf_temp', type: 'DOUBLE' },
      { name: 'fuel_level', type: 'DOUBLE' },
      { name: 'engine_load', type: 'DOUBLE' },
      { name: 'throttle_position', type: 'DOUBLE' },
      { name: 'timing_advance', type: 'DOUBLE' },
      { name: 'intake_air_temp', type: 'DOUBLE' },
      { name: 'manifold_pressure', type: 'DOUBLE' },
      { name: 'maf', type: 'DOUBLE' },
      { name: 'control_module_voltage', type: 'DOUBLE' },
    ];

    for (const column of requiredColumns) {
      if (existing.has(column.name)) {
        continue;
      }

      await this.runDuckDb(
        `ALTER TABLE drive_logs ADD COLUMN ${column.name} ${column.type};`,
        connection,
        this.driveDbKind,
      );
    }
  }

  private resetDuckDbConnection() {
    this.closeDuckDbConnection(this.duckDbConnection);
    this.closeDuckDbDatabase(this.duckDb);
    this.duckDb = null;
    this.duckDbConnection = null;
    this.duckDbInitPromise = null;
  }

  private async ensureIoDuckDbReady(): Promise<void> {
    if (!this.ioDuckDbInitPromise) {
      this.ioDuckDbInitPromise = (async () => {
        const connection = this.getIoDuckDbConnection();
        await this.runDuckDb(
          `
CREATE TABLE IF NOT EXISTS io_metrics (
  sampled_at TEXT NOT NULL,
  sampled_timestamp_ms BIGINT NOT NULL,
  drive_log_db_size_bytes BIGINT NOT NULL,
  reservation_bytes BIGINT NOT NULL,
  reservation_usage_percent DOUBLE NOT NULL,
  write_delta_bytes BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_io_metrics_sampled_timestamp
ON io_metrics(sampled_timestamp_ms DESC);
`,
          connection,
          this.ioDbKind,
        );
      })();
    }

    try {
      await this.ioDuckDbInitPromise;
    } catch (error) {
      this.closeDuckDbConnection(this.ioDuckDbConnection);
      this.closeDuckDbDatabase(this.ioDuckDb);
      this.ioDuckDbInitPromise = null;
      this.ioDuckDb = null;
      this.ioDuckDbConnection = null;
      throw error;
    }
  }

  private getIoDuckDbConnection() {
    this.normalizeDuckDbFile(this.paths.ioMetricsDuckDbPath);

    if (!this.ioDuckDbConnection) {
      this.ioDuckDb = new duckdb.Database(this.paths.ioMetricsDuckDbPath);
      this.ioDuckDbConnection = this.ioDuckDb.connect();
    }

    return this.ioDuckDbConnection;
  }

  private startIoSampling() {
    if (this.ioSampleTimer) {
      clearInterval(this.ioSampleTimer);
    }

    this.ioSampleTimer = setInterval(() => {
      void this.recordIoMetricSampleSafely();
    }, 1000);
  }

  private async recordIoMetricSampleSafely() {
    if (this.isDisposing) {
      return;
    }

    try {
      await this.recordIoMetricSample();
      this.ioSampleFailureStreak = 0;
    } catch (error) {
      if (this.isDisposing) {
        return;
      }

      // I/Oログ用 DuckDB の状態が怪しい場合は、接続を作り直して1回再試行する。
      this.resetIoDuckDbConnection();

      try {
        await this.recordIoMetricSample();
        this.ioSampleFailureStreak = 0;
        return;
      } catch (retryError) {
        if (this.isDisposing) {
          return;
        }

        this.ioSampleFailureStreak += 1;
        if (this.ioSampleFailureStreak <= 3 || this.ioSampleFailureStreak % 10 === 0) {
          console.error('Failed to append I/O metric sample:', retryError);
        }
        return;
      }
    }
  }

  private async recordIoMetricSample(): Promise<void> {
    await this.ensureIoDuckDbReady();

    const sampledTimestampMs = Date.now();
    const sampledAt = new Date(sampledTimestampMs).toISOString();
    const driveLogDbSizeBytes = this.getFileSizeBytes(this.paths.summaryDuckDbPath);
    const reservationBytes = this.configuredReservationMb * BYTES_PER_MB;
    const reservationUsagePercent = this.toPercent(driveLogDbSizeBytes, reservationBytes);
    const writeDeltaBytes = Math.max(0, driveLogDbSizeBytes - this.lastDriveLogDbSizeBytes);
    this.lastDriveLogDbSizeBytes = driveLogDbSizeBytes;

    const sql = `
INSERT INTO io_metrics (
  sampled_at,
  sampled_timestamp_ms,
  drive_log_db_size_bytes,
  reservation_bytes,
  reservation_usage_percent,
  write_delta_bytes
) VALUES (
  '${this.escapeSql(sampledAt)}',
  ${sampledTimestampMs},
  ${driveLogDbSizeBytes},
  ${reservationBytes},
  ${reservationUsagePercent},
  ${writeDeltaBytes}
);
`;

    await this.runDuckDb(sql, this.getIoDuckDbConnection(), this.ioDbKind);
  }

  private resetIoDuckDbConnection() {
    this.closeDuckDbConnection(this.ioDuckDbConnection);
    this.closeDuckDbDatabase(this.ioDuckDb);
    this.ioDuckDb = null;
    this.ioDuckDbConnection = null;
    this.ioDuckDbInitPromise = null;
  }

  private normalizeDuckDbFile(filePath: string) {
    try {
      if (!existsSync(filePath)) {
        return;
      }

      const size = statSync(filePath).size;
      if (size === 0) {
        unlinkSync(filePath);
      }
    } catch {
      // best-effort cleanup; connection path will report detailed errors if it still fails
    }
  }

  private closeDuckDbConnection(connection: any | null) {
    if (!connection) {
      return;
    }

    try {
      if (typeof connection.close === 'function') {
        connection.close(() => {
          // best-effort close
        });
      }
    } catch {
      // ignore close errors during shutdown/reconnect
    }
  }

  private closeDuckDbDatabase(db: any | null) {
    if (!db) {
      return;
    }

    try {
      if (typeof db.close === 'function') {
        db.close(() => {
          // best-effort close
        });
      }
    } catch {
      // ignore close errors during shutdown/reconnect
    }
  }

  private isDuckDbConnectionError(error: unknown): boolean {
    const message = String((error as any)?.message ?? error ?? '').toLowerCase();
    const code = String((error as any)?.code ?? '').toUpperCase();
    const errorType = String((error as any)?.errorType ?? '').toLowerCase();

    return (
      code.includes('DUCKDB')
      && (errorType.includes('connection')
        || message.includes('connection was never established')
        || message.includes('has been closed already'))
    );
  }

  private loadConfiguredReservationMb(): number {
    const rows = this.queryRows("SELECT value FROM app_settings WHERE key='log_reservation_mb' LIMIT 1;");
    const value = Number(rows[0]?.[0] ?? DEFAULT_LOG_RESERVATION_MB);
    if (!Number.isFinite(value) || value < 128) {
      return DEFAULT_LOG_RESERVATION_MB;
    }

    return Math.floor(value);
  }

  private saveConfiguredReservationMb(valueMb: number) {
    const normalized = Math.floor(Math.max(128, valueMb));
    const sql = `
INSERT INTO app_settings (key, value)
VALUES ('log_reservation_mb', '${normalized}')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
`;
    this.execute(sql);
  }

  private runDuckDb(sql: string, connection = this.getDuckDbConnection(), dbKind: 'drive' | 'io' = this.driveDbKind): Promise<void> {
    return new Promise((resolve, reject) => {
      connection.run(sql, (error: Error | null) => {
        if (error) {
          if (!this.isDuckDbConnectionError(error)) {
            reject(error);
            return;
          }

          try {
            const retryConnection = this.resetAndReconnect(dbKind);
            retryConnection.run(sql, (retryError: Error | null) => {
              if (retryError) {
                reject(retryError);
                return;
              }

              resolve();
            });
          } catch (reconnectError) {
            reject(reconnectError as Error);
          }
          return;
        }

        resolve();
      });
    });
  }

  private allDuckDb(sql: string, connection = this.getDuckDbConnection(), dbKind: 'drive' | 'io' = this.driveDbKind): Promise<any[]> {
    return new Promise((resolve, reject) => {
      connection.all(sql, (error: Error | null, rows: any[]) => {
        if (error) {
          if (!this.isDuckDbConnectionError(error)) {
            reject(error);
            return;
          }

          try {
            const retryConnection = this.resetAndReconnect(dbKind);
            retryConnection.all(sql, (retryError: Error | null, retryRows: any[]) => {
              if (retryError) {
                reject(retryError);
                return;
              }

              resolve(retryRows ?? []);
            });
          } catch (reconnectError) {
            reject(reconnectError as Error);
          }
          return;
        }

        resolve(rows ?? []);
      });
    });
  }

  private resetAndReconnect(dbKind: 'drive' | 'io') {
    if (dbKind === this.ioDbKind) {
      this.resetIoDuckDbConnection();
      return this.getIoDuckDbConnection();
    }

    this.resetDuckDbConnection();
    return this.getDuckDbConnection();
  }

  private lookupIdentityByVin(vin: string): IdentityMapRow | null {
    const normalized = vin.trim().toUpperCase();
    const escapedVin = normalized.replace(/'/g, "''");
    const sql = `
SELECT manufacturer, model, model_year, engine_code
FROM vehicle_identity_map
WHERE '${escapedVin}' LIKE vin_pattern
ORDER BY LENGTH(vin_pattern) DESC
LIMIT 1;
`;

    const result = this.execute(sql, ['-separator', '|']);

    if (!result.ok) {
      return null;
    }

    const line = result.stdout.trim();
    if (!line) {
      return null;
    }

    const [manufacturer, model, model_year, engine_code] = line.split('|');
    if (!manufacturer || !model || !model_year || !engine_code) {
      return null;
    }

    return { manufacturer, model, model_year, engine_code };
  }

  private fallbackDecode(vin: string): VehicleIdentity {
    const normalized = vin.trim().toUpperCase();
    const wmi = normalized.slice(0, 3);
    const yearCode = normalized.slice(9, 10);

    if (normalized.includes('ZD8')) {
      return {
        vin: normalized,
        manufacturer: 'SUBARU',
        model: 'BRZ (ZD8)',
        modelYear: this.decodeModelYear(yearCode),
        engineCode: 'FA24',
        confidence: 'medium',
      };
    }

    if (normalized.includes('ZN6')) {
      return {
        vin: normalized,
        manufacturer: 'SUBARU',
        model: 'BRZ (ZN6)',
        modelYear: this.decodeModelYear(yearCode),
        engineCode: 'FA20',
        confidence: 'medium',
      };
    }

    const manufacturerByWmi: Record<string, string> = {
      JF1: 'SUBARU',
      JF2: 'SUBARU',
      '4S3': 'SUBARU',
      JT2: 'TOYOTA',
      JTD: 'TOYOTA',
      JTE: 'TOYOTA',
    };

    const modelYear = this.decodeModelYear(yearCode);

    return {
      vin: normalized,
      manufacturer: manufacturerByWmi[wmi] ?? 'Unknown',
      model: 'Unknown',
      modelYear,
      engineCode: 'Unknown',
      confidence: manufacturerByWmi[wmi] ? 'medium' : 'low',
    };
  }

  private decodeModelYear(code: string): string {
    const map: Record<string, number> = {
      A: 2010,
      B: 2011,
      C: 2012,
      D: 2013,
      E: 2014,
      F: 2015,
      G: 2016,
      H: 2017,
      J: 2018,
      K: 2019,
      L: 2020,
      M: 2021,
      N: 2022,
      P: 2023,
      R: 2024,
      S: 2025,
      T: 2026,
      V: 2027,
      W: 2028,
      X: 2029,
      Y: 2030,
      1: 2001,
      2: 2002,
      3: 2003,
      4: 2004,
      5: 2005,
      6: 2006,
      7: 2007,
      8: 2008,
      9: 2009,
    };

    const year = map[code];
    return year ? String(year) : 'Unknown';
  }

  private queryRows(sql: string): string[][] {
    const result = this.execute(sql, ['-separator', '\t']);
    if (!result.ok) {
      return [];
    }

    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.map((line) => line.split('\t'));
  }

  private getFileSizeBytes(filePath: string): number {
    try {
      return existsSync(filePath) ? statSync(filePath).size : 0;
    } catch {
      return 0;
    }
  }

  private getVolumeStats(rootPath: string): { totalBytes: number; freeBytes: number } {
    try {
      const stats = statfsSync(rootPath);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      return { totalBytes, freeBytes };
    } catch {
      return { totalBytes: 0, freeBytes: 0 };
    }
  }

  private toPercent(sizeBytes: number, capacityBytes: number): number {
    if (capacityBytes <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(100, (sizeBytes / capacityBytes) * 100));
  }

  private execute(sql: string, extraArgs: string[] = []): { ok: boolean; stdout: string; stderr: string } {
    const args = [...extraArgs, this.paths.masterSqlitePath, sql];
    const result = spawnSync('sqlite3', args, { encoding: 'utf8' });

    if (result.error || result.status !== 0) {
      return {
        ok: false,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? String(result.error ?? 'sqlite command failed'),
      };
    }

    return {
      ok: true,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  private escapeSql(value: string): string {
    return value.replace(/'/g, "''");
  }

  private toNumberLiteral(value: number): string {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
