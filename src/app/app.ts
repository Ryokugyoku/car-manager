import { Component, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LiveDashboardComponent } from './obd-dashboard/obd-dashboard';
import {
  ConnectionHistoryRecord,
  DriveLogRecord,
  IoMetricRange,
  IoMetricSample,
  KnownVehicleRecord,
  OBDData,
  OBDService,
  MonitoringMode,
  SerialPortInfo,
  StorageOverview,
  StoragePaths,
  VehicleProfile,
} from '../services/obd.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type AppView = 'dashboard' | 'storage' | 'connection-setup' | 'known-vehicles' | 'connection-history' | 'drive-logs';
type StorageAlertLevel = 'warning' | 'critical';

interface StorageAlert {
  level: StorageAlertLevel;
  message: string;
}

const STORAGE_POLL_INTERVAL_MS = 5000;
const DRIVE_LOG_AUTO_REFRESH_INTERVAL_MS = 15000;
const MAX_IO_BARS = 360;
const SERIAL_MANAGER_NAMES_KEY = 'serialManagerNames';
const MB = 1024 * 1024;

type DriveLogMetricKey = keyof Pick<DriveLogRecord,
  | 'speed'
  | 'rpm'
  | 'engineTemp'
  | 'engineOilTemp'
  | 'atfTemp'
  | 'fuelLevel'
  | 'engineLoad'
  | 'throttlePosition'
  | 'timingAdvance'
  | 'intakeAirTemp'
  | 'manifoldPressure'
  | 'maf'
  | 'controlModuleVoltage'
>;

interface DriveLogMetricDefinition {
  key: DriveLogMetricKey;
  label: string;
  shortLabel: string;
  unit: string;
  color: string;
  decimals: number;
}

interface DriveLogChartSeries extends DriveLogMetricDefinition {
  min: number | null;
  max: number | null;
  latest: number | null;
  sampleCount: number;
  paths: string[];
}

type DriveLogGroupKey = 'thermal' | 'driverDemand' | 'motion' | 'airflow' | 'electrical';

interface DriveLogGroupDefinition {
  key: DriveLogGroupKey;
  label: string;
  description: string;
  metricKeys: DriveLogMetricKey[];
  axisMode: 'shared' | 'normalized';
  axisUnit: string;
}

interface DriveLogChartGroup extends DriveLogGroupDefinition {
  min: number | null;
  max: number | null;
  series: DriveLogChartSeries[];
}

type ReservationUsageLevel = 'green' | 'yellow' | 'yellow-alert' | 'red-alert';

@Component({
  selector: 'app-root',
  imports: [CommonModule, LiveDashboardComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit {
  readonly driveLogMetrics: DriveLogMetricDefinition[] = [
    { key: 'speed', label: 'Vehicle Speed', shortLabel: 'Speed', unit: 'km/h', color: '#38bdf8', decimals: 0 },
    { key: 'rpm', label: 'Engine Speed', shortLabel: 'RPM', unit: 'rpm', color: '#818cf8', decimals: 0 },
    { key: 'engineTemp', label: 'Coolant Temperature', shortLabel: 'Coolant', unit: '°C', color: '#fb7185', decimals: 0 },
    { key: 'engineOilTemp', label: 'Engine Oil Temperature', shortLabel: 'Oil Temp', unit: '°C', color: '#f97316', decimals: 0 },
    { key: 'atfTemp', label: 'ATF Temperature', shortLabel: 'ATF Temp', unit: '°C', color: '#f59e0b', decimals: 0 },
    { key: 'fuelLevel', label: 'Fuel Level', shortLabel: 'Fuel', unit: '%', color: '#34d399', decimals: 0 },
    { key: 'engineLoad', label: 'Calculated Engine Load', shortLabel: 'Load', unit: '%', color: '#2dd4bf', decimals: 0 },
    { key: 'throttlePosition', label: 'Throttle Position', shortLabel: 'Throttle', unit: '%', color: '#22d3ee', decimals: 0 },
    { key: 'timingAdvance', label: 'Timing Advance', shortLabel: 'Timing', unit: '°BTDC', color: '#e879f9', decimals: 1 },
    { key: 'intakeAirTemp', label: 'Intake Air Temperature', shortLabel: 'Intake', unit: '°C', color: '#c084fc', decimals: 0 },
    { key: 'manifoldPressure', label: 'Manifold Pressure', shortLabel: 'MAP', unit: 'kPa', color: '#a78bfa', decimals: 0 },
    { key: 'maf', label: 'Mass Air Flow', shortLabel: 'MAF', unit: 'g/s', color: '#f472b6', decimals: 1 },
    { key: 'controlModuleVoltage', label: 'Control Module Voltage', shortLabel: 'Voltage', unit: 'V', color: '#facc15', decimals: 1 },
  ];
  readonly driveLogGroups: DriveLogGroupDefinition[] = [
    {
      key: 'thermal', label: 'Thermal', description: '温度系',
      metricKeys: ['engineTemp', 'engineOilTemp', 'atfTemp', 'intakeAirTemp'], axisMode: 'shared', axisUnit: '°C',
    },
    {
      key: 'driverDemand', label: 'Demand & Load', description: '負荷・開度・燃料',
      metricKeys: ['engineLoad', 'throttlePosition', 'fuelLevel'], axisMode: 'shared', axisUnit: '%',
    },
    {
      key: 'motion', label: 'Motion & Combustion', description: '走行・回転・点火',
      metricKeys: ['speed', 'rpm', 'timingAdvance'], axisMode: 'normalized', axisUnit: 'RELATIVE',
    },
    {
      key: 'airflow', label: 'Airflow', description: '吸気圧・空気流量',
      metricKeys: ['manifoldPressure', 'maf'], axisMode: 'normalized', axisUnit: 'RELATIVE',
    },
    {
      key: 'electrical', label: 'Electrical', description: '電源状態',
      metricKeys: ['controlModuleVoltage'], axisMode: 'shared', axisUnit: 'V',
    },
  ];
  protected readonly title = signal('car-manager');
  isConnected = signal(false);
  connectionStatus = signal('Not Connected');
  isLoading = signal(false);
  currentView = signal<AppView>('dashboard');
  flashMessage = signal('');
  selectedMode = signal<MonitoringMode>('obd2-standard');
  supportedModes = signal<MonitoringMode[]>(['obd2-standard']);
  serialPorts = signal<SerialPortInfo[]>([]);
  selectedPortPath = signal('');
  showManualPortPicker = signal(false);
  serialManagerNames = signal<Record<string, string>>({});
  knownVehicles = signal<KnownVehicleRecord[]>([]);
  connectionHistory = signal<ConnectionHistoryRecord[]>([]);
  driveLogs = signal<DriveLogRecord[]>([]);
  newKnownVehicle = signal({
    vinPattern: '',
    manufacturer: '',
    model: '',
    modelYear: '',
    engineCode: '',
  });
  vehicleProfile = signal<VehicleProfile>({
    vin: null,
    manufacturer: 'Unknown',
    model: 'Unknown',
    modelYear: 'Unknown',
    engineCode: 'Unknown',
    confidence: 'low',
  });
  storagePaths = signal<StoragePaths | null>(null);
  storageOverview = signal<StorageOverview | null>(null);
  ioMetrics = signal<Record<IoMetricRange, IoMetricSample[]>>({
    '1m': [],
    '1h': [],
    all: [],
  });
  reservationMbInput = signal(5120);
  storageAlert = signal<StorageAlert | null>(null);
  reservationActionError = signal<string | null>(null);
  driveLogChartGroups = signal<DriveLogChartGroup[]>([]);
  driveLogGroupVisibility = signal<Record<DriveLogGroupKey, boolean>>(
    Object.fromEntries(this.driveLogGroups.map((group) => [group.key, true])) as Record<DriveLogGroupKey, boolean>,
  );
  visibleDriveLogGroups = computed(() =>
    this.driveLogChartGroups().filter((group) => this.driveLogGroupVisibility()[group.key]),
  );
  obdData = signal<OBDData>({
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
    timestamp: 0,
  });

  private destroy$ = new Subject<void>();
  private unlistenConnectionState: (() => void) | null = null;
  private storagePollTimer: ReturnType<typeof setInterval> | null = null;
  private lastDriveLogsRefreshAt = 0;
  private reservationInputDirty = false;
  private isDocumentHidden = false;
  private lastStorageNotice = '';

  constructor(private obdService: OBDService) {}

  ngOnInit() {
    this.loadSerialManagerNames();
    void this.loadSupportedModes();
    void this.loadStoragePaths(false);
    void this.refreshKnownVehicles();
    void this.refreshConnectionHistory();
    void this.refreshDriveLogs();

    this.unlistenConnectionState = this.obdService.onConnectionState((state) => {
      if (!state.connected) {
        this.isConnected.set(false);
        this.connectionStatus.set(`Disconnected: ${state.reason ?? 'unknown'}`);
        void this.moveToConnectionSetup();
        void this.refreshConnectionHistory();
        void this.refreshDriveLogs();
      }
    });

    this.obdService
      .getOBDDataStream()
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        this.obdData.set(data);

        if (this.currentView() === 'drive-logs' && Date.now() - this.lastDriveLogsRefreshAt >= DRIVE_LOG_AUTO_REFRESH_INTERVAL_MS) {
          void this.refreshDriveLogs();
        }
      });

    this.storagePollTimer = setInterval(() => {
      if (!this.isDocumentHidden) {
        void this.loadStoragePaths(false);
      }
    }, STORAGE_POLL_INTERVAL_MS);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  setView(view: AppView) {
    this.currentView.set(view);

    if (view === 'storage') {
      void this.loadStoragePaths(true);
      return;
    }

    if (view === 'known-vehicles') {
      void this.refreshKnownVehicles();
      return;
    }

    if (view === 'connection-setup') {
      void this.loadSerialPorts();
      return;
    }

    if (view === 'connection-history') {
      void this.refreshConnectionHistory();
      return;
    }

    if (view === 'drive-logs') {
      void this.refreshDriveLogs();
    }
  }

  updateKnownVehicleField(field: 'vinPattern' | 'manufacturer' | 'model' | 'modelYear' | 'engineCode', value: string) {
    this.newKnownVehicle.update((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async refreshKnownVehicles() {
    const rows = await this.obdService.listKnownVehicles();
    this.knownVehicles.set(rows);
  }

  async refreshConnectionHistory() {
    const rows = await this.obdService.listConnectionHistory();
    this.connectionHistory.set(rows);
  }

  async refreshDriveLogs() {
    const rows = await this.obdService.listDriveLogs();
    this.driveLogs.set(rows);
    this.rebuildDriveLogMetricSummary(rows);
    this.lastDriveLogsRefreshAt = Date.now();
    const overview = await this.obdService.getStorageOverview();
    this.storageOverview.set(overview);
    this.applyStorageAlert(overview);
  }

  async saveKnownVehicle() {
    const payload = this.newKnownVehicle();

    if (!payload.vinPattern || !payload.manufacturer || !payload.model) {
      this.flash('VIN Pattern / Manufacturer / Model は必須です');
      return;
    }

    const result = await this.obdService.upsertKnownVehicle(payload);
    if (!result.success) {
      this.flash(`登録失敗: ${result.message ?? 'unknown error'}`);
      return;
    }

    this.newKnownVehicle.set({
      vinPattern: '',
      manufacturer: '',
      model: '',
      modelYear: '',
      engineCode: '',
    });
    this.flash('既知車種マスタを保存しました');
    await this.refreshKnownVehicles();
  }

  async removeKnownVehicle(id: number) {
    const result = await this.obdService.deleteKnownVehicle(id);
    if (!result.success) {
      this.flash(`削除失敗: ${result.message ?? 'unknown error'}`);
      return;
    }

    this.flash('既知車種を削除しました');
    await this.refreshKnownVehicles();
  }

  toggleDriveLogGroup(group: DriveLogGroupKey) {
    this.driveLogGroupVisibility.update((visibility) => ({
      ...visibility,
      [group]: !visibility[group],
    }));
  }

  setAllDriveLogGroups(visible: boolean) {
    this.driveLogGroupVisibility.set(
      Object.fromEntries(this.driveLogGroups.map((group) => [group.key, visible])) as Record<DriveLogGroupKey, boolean>,
    );
  }

  isDriveLogGroupVisible(group: DriveLogGroupKey): boolean {
    return this.driveLogGroupVisibility()[group];
  }

  isDriveLogMetricVisible(metric: DriveLogMetricKey): boolean {
    const group = this.driveLogGroups.find((candidate) => candidate.metricKeys.includes(metric));
    return group ? this.isDriveLogGroupVisible(group.key) : true;
  }

  formatDriveLogValue(value: number | null, metric: DriveLogMetricDefinition): string {
    if (value === null || !Number.isFinite(value)) {
      return '—';
    }
    return `${value.toFixed(metric.decimals)} ${metric.unit}`;
  }

  formatDriveLogGroupRange(group: DriveLogChartGroup): string {
    if (group.axisMode === 'normalized') {
      return '各系列の実測min–maxで正規化';
    }
    if (group.min === null || group.max === null) {
      return 'データなし';
    }
    return `${group.min.toFixed(1)} → ${group.max.toFixed(1)} ${group.axisUnit}`;
  }

  getDriveLogAxisLabels(group: DriveLogChartGroup): string[] {
    if (group.axisMode === 'normalized') {
      return ['100%', '50%', '0%'];
    }
    if (group.min === null || group.max === null) {
      return ['—', '—', '—'];
    }

    const middle = group.min + ((group.max - group.min) / 2);
    const decimals = group.axisUnit === 'V' ? 1 : 0;
    return [group.max, middle, group.min].map((value) => `${value.toFixed(decimals)} ${group.axisUnit}`);
  }

  formatDriveLogTime(timestampMs: number, includeDate = false): string {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      return '—';
    }
    return new Intl.DateTimeFormat('ja-JP', {
      month: includeDate ? '2-digit' : undefined,
      day: includeDate ? '2-digit' : undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: includeDate ? undefined : '2-digit',
      hour12: false,
    }).format(new Date(timestampMs));
  }

  isDriveLogTemperatureUnavailable(value: number | null, rpm: number | null): boolean {
    if (value === null || !Number.isFinite(value)) {
      return true;
    }

    if (rpm !== null && Number.isFinite(rpm) && rpm >= 500 && value === 0) {
      return true;
    }

    return false;
  }

  private flash(message: string) {
    this.flashMessage.set(message);
    setTimeout(() => {
      if (this.flashMessage() === message) {
        this.flashMessage.set('');
      }
    }, 2200);
  }

  async loadStoragePaths(includeIoMetrics: boolean) {
    const paths = await this.obdService.getStoragePaths();
    this.storagePaths.set(paths);
    const overview = await this.obdService.getStorageOverview();
    this.storageOverview.set(overview);

    if (overview && (!this.reservationInputDirty || this.currentView() !== 'storage')) {
      this.reservationMbInput.set(overview.reservationConfiguredMb);
      this.reservationInputDirty = false;
    }

    this.applyStorageAlert(overview);

    if (!includeIoMetrics) {
      return;
    }

    const oneMinute = await this.obdService.listIoMetrics('1m');
    const oneHour = await this.obdService.listIoMetrics('1h');
    const all = await this.obdService.listIoMetrics('all');
    this.ioMetrics.set({
      '1m': oneMinute,
      '1h': oneHour,
      all,
    });
  }

  getIoBars(range: IoMetricRange): number[] {
    const samples = this.ioMetrics()[range];
    if (!samples.length) {
      return [];
    }

    const chartSamples = this.downsampleIoSamples(samples, MAX_IO_BARS);

    const maxDelta = Math.max(...chartSamples.map((sample) => sample.writeDeltaBytes), 1);
    return chartSamples.map((sample) => Math.max(4, Math.round((sample.writeDeltaBytes / maxDelta) * 100)));
  }

  private downsampleIoSamples(samples: IoMetricSample[], maxPoints: number): IoMetricSample[] {
    if (samples.length <= maxPoints) {
      return samples;
    }

    const bucketSize = Math.ceil(samples.length / maxPoints);
    const reduced: IoMetricSample[] = [];

    for (let i = 0; i < samples.length; i += bucketSize) {
      const bucket = samples.slice(i, i + bucketSize);
      if (!bucket.length) {
        continue;
      }

      const peak = bucket.reduce((prev, current) => (current.writeDeltaBytes >= prev.writeDeltaBytes ? current : prev), bucket[0]);
      reduced.push(peak);
    }

    return reduced;
  }

  getIoLatestRate(range: IoMetricRange): string {
    const samples = this.ioMetrics()[range];
    if (!samples.length) {
      return '0 B/s';
    }

    const latest = samples[samples.length - 1]?.writeDeltaBytes ?? 0;
    return `${this.formatBytes(latest)}/s`;
  }

  getIoPeakRate(range: IoMetricRange): string {
    const samples = this.ioMetrics()[range];
    if (!samples.length) {
      return '0 B/s';
    }

    const peak = Math.max(...samples.map((sample) => sample.writeDeltaBytes), 0);
    return `${this.formatBytes(peak)}/s`;
  }

  async saveReservationSetting() {
    const inputMb = Math.floor(Number(this.reservationMbInput()));
    const result = await this.obdService.setLogReservationMb(inputMb);

    if (!result.success) {
      this.reservationActionError.set(result.message ?? 'Reservation update failed.');
      this.storageAlert.set({
        level: 'critical',
        message: '予約領域の確保に失敗しました。Storage画面で容量縮小または空き容量確保後に再試行してください。',
      });
      return;
    }

    this.reservationInputDirty = false;
    this.reservationActionError.set(null);
    await this.loadStoragePaths(true);
  }

  async reallocateReservation() {
    const result = await this.obdService.reallocateReservation();

    if (!result.success) {
      this.reservationActionError.set(result.message ?? 'Reservation re-allocation failed.');
      this.storageAlert.set({
        level: 'critical',
        message: '予約領域の再確保に失敗しました。Storage画面で容量を縮小するか空き容量を確保してください。',
      });
      return;
    }

    this.reservationInputDirty = false;
    this.reservationActionError.set(null);
    await this.loadStoragePaths(true);
  }

  onReservationInputChanged(value: string) {
    this.reservationInputDirty = true;
    this.reservationMbInput.set(Number(value) || 0);
  }

  goToStorage() {
    this.setView('storage');
  }

  private async moveToConnectionSetup() {
    this.showManualPortPicker.set(true);
    this.currentView.set('connection-setup');
    await this.loadSerialPorts();
  }

  private applyStorageAlert(overview: StorageOverview | null) {
    if (!overview) {
      return;
    }

    if (overview.dbVolumeNotice && overview.dbVolumeNotice !== this.lastStorageNotice) {
      this.flash(overview.dbVolumeNotice);
      this.lastStorageNotice = overview.dbVolumeNotice;
    }

    if (overview.ioLogDbLimitExceeded || overview.dbVolumeCritical) {
      this.storageAlert.set({
        level: 'critical',
        message: overview.dbVolumeCritical
          ? 'DB専用ボリュームの容量が限界に近づいています。Storage設定で容量を拡張してください。'
          : 'I/OログDBが1GBを超えました。Storage画面で容量調整または再確保操作を行ってください。',
      });
      return;
    }

    if (overview.dbVolumeWarning || overview.reservationWarning) {
      const ignorePolicy = overview.dbVolumeAutoCleanupPolicy || '容量不足が続くと最古日付のログを1日分削除します。';
      this.storageAlert.set({
        level: 'warning',
        message: `DB専用ボリュームの使用率が高くなっています。Storage画面で容量を拡張してください。${ignorePolicy}`,
      });
      return;
    }

    this.storageAlert.set(null);
  }

  private rebuildDriveLogMetricSummary(rows: DriveLogRecord[]) {
    const timeline = [...rows].sort((a, b) => a.sampleTimestampMs - b.sampleTimestampMs);
    const start = timeline[0]?.sampleTimestampMs ?? 0;
    const end = timeline[timeline.length - 1]?.sampleTimestampMs ?? start;
    const duration = Math.max(end - start, 1);
    const chartWidth = 1000;
    const chartHeight = 150;
    const topPadding = 10;
    const bottomPadding = 10;
    const plotHeight = chartHeight - topPadding - bottomPadding;

    this.driveLogChartGroups.set(this.driveLogGroups.map((group) => {
      const metrics = group.metricKeys.map((key) => this.driveLogMetrics.find((metric) => metric.key === key)!);
      const groupValues = metrics.flatMap((metric) => timeline
        .map((row) => row[metric.key])
        .filter((value): value is number => value !== null && Number.isFinite(value)));
      const groupBounds = this.getDriveLogBounds(groupValues);

      const series = metrics.map((metric): DriveLogChartSeries => {
        const values = timeline
          .map((row) => row[metric.key])
          .filter((value): value is number => value !== null && Number.isFinite(value));
        const metricBounds = this.getDriveLogBounds(values);
        const plotBounds = group.axisMode === 'shared' ? groupBounds : metricBounds;
        const range = plotBounds.min !== null && plotBounds.max !== null
          ? Math.max(plotBounds.max - plotBounds.min, 1)
          : 1;
        const paths: string[] = [];
        let currentPath = '';
        let firstPoint: { x: number; y: number } | null = null;

        for (const row of timeline) {
          const value = row[metric.key];
          if (value === null || !Number.isFinite(value) || plotBounds.min === null || plotBounds.max === null) {
            // 各1秒スナップショットでは未取得PIDがNULLになる。
            // NULLで線を分断せず、同じ系列の次の実測値まで接続する。
            continue;
          }

          const x = ((row.sampleTimestampMs - start) / duration) * chartWidth;
          const normalized = plotBounds.max === plotBounds.min ? 0.5 : (value - plotBounds.min) / range;
          const y = topPadding + (1 - normalized) * plotHeight;
          firstPoint ??= { x, y };
          currentPath += `${currentPath ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        }
        if (currentPath) {
          // 1サンプルだけでも丸い線端が点として見えるよう、ごく短い線分にする。
          if (values.length === 1 && firstPoint) {
            currentPath += ` L ${(firstPoint.x + 0.01).toFixed(2)} ${firstPoint.y.toFixed(2)}`;
          }
          paths.push(currentPath);
        }

        const latest = [...timeline].reverse().find((row) => {
          const value = row[metric.key];
          return value !== null && Number.isFinite(value);
        })?.[metric.key] ?? null;

        return { ...metric, ...metricBounds, latest, sampleCount: values.length, paths };
      });

      return { ...group, ...groupBounds, series };
    }));
  }

  private getDriveLogBounds(values: number[]): { min: number | null; max: number | null } {
    if (!values.length) {
      return { min: null, max: null };
    }

    return values.reduce(
      (current, value) => ({ min: Math.min(current.min, value), max: Math.max(current.max, value) }),
      { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    );
  }

  private handleVisibilityChange = () => {
    this.isDocumentHidden = document.hidden;

    if (!this.isDocumentHidden && this.currentView() === 'storage') {
      void this.loadStoragePaths(true);
    }
  };

  formatBytes(value: number | null | undefined): string {
    const bytes = Number(value ?? 0);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let index = 0;

    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }

    return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
  }

  formatPercent(value: number | null | undefined): string {
    const percent = Number(value ?? 0);
    if (!Number.isFinite(percent)) {
      return '0.0%';
    }

    return `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
  }

  getHeaderReservationUsageText(): string {
    const overview = this.storageOverview();
    if (!overview) {
      return '--% (-- MB / -- MB)';
    }

    const percent = Math.max(0, Math.min(100, Number(overview.dbVolumeUsagePercent ?? overview.reservationUsagePercent ?? 0)));
    const usedBytes = Number(overview.dbVolumeUsedBytes ?? 0);
    const usedMb = (usedBytes / MB).toFixed(1);
    const configuredMb = Number((overview.dbVolumeSizeBytes ?? 0) / MB).toFixed(0);
    return `${percent.toFixed(1)}% (${usedMb} MB / ${configuredMb} MB)`;
  }

  getHeaderReservationUsageLevel(): ReservationUsageLevel {
    const overview = this.storageOverview();
    const percent = Math.max(0, Math.min(100, Number(overview?.dbVolumeUsagePercent ?? overview?.reservationUsagePercent ?? 0)));

    if (percent < 60) {
      return 'green';
    }

    if (percent < 70) {
      return 'yellow';
    }

    if (percent <= 80) {
      return 'yellow-alert';
    }

    return 'red-alert';
  }

  getHeaderReservationUsageIcon(): string {
    const level = this.getHeaderReservationUsageLevel();

    if (level === 'yellow-alert') {
      return 'warning';
    }

    if (level === 'red-alert') {
      return 'priority_high';
    }

    return '';
  }

  async loadSupportedModes() {
    const modes = await this.obdService.getSupportedModes();
    this.supportedModes.set(modes);

    if (!modes.includes(this.selectedMode())) {
      this.selectedMode.set(modes[0] ?? 'obd2-standard');
    }
  }

  onModeChanged(value: string) {
    const nextMode = value as MonitoringMode;

    if (this.supportedModes().includes(nextMode)) {
      this.selectedMode.set(nextMode);
    }
  }

  getMonitoringModeLabel(mode: MonitoringMode): string {
    return mode === 'asc-coupler' ? 'ASC Coupler' : 'OBD2 Standard';
  }

  async connectOBD() {
    await this.connectOBDWithPort();
  }

  private async connectOBDWithPort(portPath?: string) {
    if (this.isConnected() || this.isLoading()) {
      return;
    }

    this.isLoading.set(true);
    this.connectionStatus.set(`Connecting ${this.getMonitoringModeLabel(this.selectedMode())}...`);
    const result = await this.obdService.connect(portPath, this.selectedMode());

    if (result.success) {
      this.isConnected.set(true);
      const modeLabel = this.getMonitoringModeLabel(this.selectedMode());
      this.connectionStatus.set(`Connected to OBDLiNKEX (${modeLabel})`);
      await this.refreshVehicleProfile();
    } else {
      this.isConnected.set(false);
      this.connectionStatus.set(`Error: ${result.message}`);
      await this.moveToConnectionSetup();
    }

    this.isLoading.set(false);
  }

  async loadSerialPorts() {
    const ports = await this.obdService.listPorts();
    const normalized = [...ports].sort((a, b) => {
      const manufacturerCompare = this.getPortManagerName(a).localeCompare(this.getPortManagerName(b));
      if (manufacturerCompare !== 0) {
        return manufacturerCompare;
      }

      return a.path.localeCompare(b.path);
    });

    this.serialPorts.set(normalized);

    if (!normalized.length) {
      this.selectedPortPath.set('');
      return;
    }

    const current = this.selectedPortPath();
    if (!current || !normalized.some((port) => port.path === current)) {
      this.selectedPortPath.set(normalized[0]?.path ?? '');
    }
  }

  onSelectedPortChanged(value: string) {
    this.selectedPortPath.set(value);
  }

  getPortManagerName(port: SerialPortInfo): string {
    const manufacturer = (port.manufacturer || '').trim();
    if (manufacturer && manufacturer.toLowerCase() !== 'unknown') {
      return manufacturer;
    }

    const custom = this.serialManagerNames()[port.path]?.trim();
    if (custom) {
      return custom;
    }

    return `Unlabeled (${port.path})`;
  }

  isManufacturerUnknown(port: SerialPortInfo): boolean {
    const manufacturer = (port.manufacturer || '').trim().toLowerCase();
    return !manufacturer || manufacturer === 'unknown';
  }

  getSerialOptionLabel(port: SerialPortInfo): string {
    return `${this.getPortManagerName(port)} - ${port.path}`;
  }

  updateSerialManagerName(path: string, value: string) {
    this.serialManagerNames.update((current) => ({
      ...current,
      [path]: value,
    }));
    this.persistSerialManagerNames();
  }

  async trySelectedPort() {
    const selected = this.selectedPortPath();
    if (!selected) {
      this.connectionStatus.set('No serial port selected');
      return;
    }

    await this.connectOBDWithPort(selected);
  }

  private loadSerialManagerNames() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(SERIAL_MANAGER_NAMES_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, string>;
      this.serialManagerNames.set(parsed ?? {});
    } catch {
      this.serialManagerNames.set({});
    }
  }

  private persistSerialManagerNames() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(SERIAL_MANAGER_NAMES_KEY, JSON.stringify(this.serialManagerNames()));
  }

  private async refreshVehicleProfile() {
    // 接続直後はECUの応答が遅れることがあるため、短い間隔で数回再取得する。
    for (let i = 0; i < 3; i += 1) {
      const profile = await this.obdService.getVehicleProfile();
      this.vehicleProfile.set(profile);

      if (profile.vin) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  async disconnectOBD() {
    this.isLoading.set(true);
    const result = await this.obdService.disconnect();

    if (result.success) {
      this.isConnected.set(false);
      this.connectionStatus.set('Disconnected');
      this.vehicleProfile.set({
        vin: null,
        manufacturer: 'Unknown',
        model: 'Unknown',
        modelYear: 'Unknown',
        engineCode: 'Unknown',
        confidence: 'low',
      });
    } else {
      this.connectionStatus.set(`Error: ${result.message}`);
    }

    this.isLoading.set(false);
    await this.refreshConnectionHistory();
  }

  ngOnDestroy() {
    if (this.storagePollTimer) {
      clearInterval(this.storagePollTimer);
      this.storagePollTimer = null;
    }

    if (this.unlistenConnectionState) {
      this.unlistenConnectionState();
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.destroy$.next();
    this.destroy$.complete();
  }
}
