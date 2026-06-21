import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OBDData } from '../../services/obd.service';

type MetricKey =
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
  | 'controlModuleVoltage';

interface MetricConfig {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  accent: string;
  icon: string;
}

interface MetricState extends MetricConfig {
  current: number | null;
  min: number | null;
  max: number | null;
  previous: number | null;
}

@Component({
  selector: 'app-live-dashboard',
  imports: [CommonModule],
  templateUrl: './obd-dashboard.html',
  styleUrls: ['./obd-dashboard.css'],
})
export class LiveDashboardComponent {
  private readonly configs: MetricConfig[] = [
    { key: 'rpm', label: 'Engine RPM', unit: 'rpm', decimals: 0, accent: '#f97316', icon: 'speed' },
    { key: 'speed', label: 'Vehicle Speed', unit: 'km/h', decimals: 0, accent: '#22c55e', icon: 'route' },
    { key: 'engineLoad', label: 'Engine Load', unit: '%', decimals: 0, accent: '#60a5fa', icon: 'donut_small' },
    { key: 'throttlePosition', label: 'Throttle', unit: '%', decimals: 0, accent: '#a78bfa', icon: 'swipe_up' },
    { key: 'engineTemp', label: 'Coolant Temp', unit: '°C', decimals: 0, accent: '#fb7185', icon: 'thermostat' },
    { key: 'engineOilTemp', label: 'Engine Oil Temp', unit: '°C', decimals: 0, accent: '#f59e0b', icon: 'oil_barrel' },
    { key: 'atfTemp', label: 'ATF Temp', unit: '°C', decimals: 0, accent: '#ef4444', icon: 'water_drop' },
    { key: 'intakeAirTemp', label: 'Intake Air Temp', unit: '°C', decimals: 0, accent: '#38bdf8', icon: 'air' },
    { key: 'fuelLevel', label: 'Fuel Level', unit: '%', decimals: 0, accent: '#facc15', icon: 'local_gas_station' },
    { key: 'timingAdvance', label: 'Timing Advance', unit: '°BTDC', decimals: 1, accent: '#e879f9', icon: 'bolt' },
    { key: 'manifoldPressure', label: 'MAP', unit: 'kPa', decimals: 0, accent: '#34d399', icon: 'compress' },
    { key: 'maf', label: 'MAF', unit: 'g/s', decimals: 1, accent: '#f472b6', icon: 'show_chart' },
    { key: 'controlModuleVoltage', label: 'ECU Voltage', unit: 'V', decimals: 2, accent: '#c4b5fd', icon: 'electrical_services' },
  ];

  metricStates: MetricState[] = this.configs.map((config) => ({
    ...config,
    current: null,
    min: null,
    max: null,
    previous: null,
  }));

  private connected = false;
  private hasSessionData = false;

  @Input() set isConnected(value: boolean) {
    const transitionedToConnected = !this.connected && value;
    this.connected = value;

    if (!value) {
      this.resetMetrics();
    } else if (transitionedToConnected) {
      this.resetMetrics();
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  @Input() connectionStatus = 'Not Connected';

  @Input() set data(value: OBDData | null) {
    if (!value || !this.connected) {
      return;
    }

    this.applyData(value);
  }

  private resetMetrics() {
    this.hasSessionData = false;
    this.metricStates = this.configs.map((config) => ({
      ...config,
      current: null,
      min: null,
      max: null,
      previous: null,
    }));
  }

  private applyData(data: OBDData) {
    this.metricStates = this.metricStates.map((metric) => {
      const value = data[metric.key];
      const nextCurrent = Number.isFinite(value) ? value : null;

      if (nextCurrent === null) {
        return {
          ...metric,
          previous: metric.current,
          current: null,
        };
      }

      if (!this.hasSessionData || metric.current === null) {
        return {
          ...metric,
          previous: metric.current,
          current: nextCurrent,
          min: nextCurrent,
          max: nextCurrent,
        };
      }

      return {
        ...metric,
        previous: metric.current,
        current: nextCurrent,
        min: metric.min === null ? nextCurrent : Math.min(metric.min, nextCurrent),
        max: metric.max === null ? nextCurrent : Math.max(metric.max, nextCurrent),
      };
    });

    this.hasSessionData = true;
  }

  formatValue(value: number | null, decimals: number, unit: string): string {
    if (value === null) {
      return '—';
    }

    const formatted = value.toFixed(decimals);
    return unit ? `${formatted} ${unit}` : formatted;
  }

  getPrimaryMetric(key: MetricKey): MetricState {
    return this.metricStates.find((metric) => metric.key === key) ?? this.metricStates[0];
  }

  getRangePercent(metric: MetricState): number {
    if (metric.current === null || metric.min === null || metric.max === null) {
      return 0;
    }

    if (metric.max === metric.min) {
      return 100;
    }

    const ratio = (metric.current - metric.min) / (metric.max - metric.min);
    return Math.max(0, Math.min(100, ratio * 100));
  }

  isMetricMissing(metric: MetricState): boolean {
    return metric.current === null;
  }

  getMetricState(metric: MetricState): 'normal' | 'missing' | 'alert' {
    if (metric.current === null) {
      return 'missing';
    }

    if (metric.previous === null) {
      return 'normal';
    }

    const threshold = this.getAlertThreshold(metric.key);
    const delta = Math.abs(metric.current - metric.previous);
    const base = Math.max(Math.abs(metric.previous), 1);
    const ratio = delta / base;

    if (delta >= threshold.absolute || ratio >= threshold.ratio) {
      return 'alert';
    }

    return 'normal';
  }

  getDeltaText(metric: MetricState): string {
    if (metric.current === null || metric.previous === null) {
      return '—';
    }

    const delta = metric.current - metric.previous;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(metric.decimals)}`;
  }

  private getAlertThreshold(key: MetricKey): { absolute: number; ratio: number } {
    switch (key) {
      case 'rpm':
        return { absolute: 700, ratio: 0.35 };
      case 'speed':
        return { absolute: 20, ratio: 0.35 };
      case 'engineTemp':
      case 'engineOilTemp':
      case 'atfTemp':
        return { absolute: 12, ratio: 0.18 };
      case 'timingAdvance':
        return { absolute: 6, ratio: 0.4 };
      case 'engineLoad':
      case 'throttlePosition':
        return { absolute: 18, ratio: 0.35 };
      case 'fuelLevel':
        return { absolute: 8, ratio: 0.12 };
      case 'maf':
        return { absolute: 12, ratio: 0.4 };
      case 'manifoldPressure':
        return { absolute: 15, ratio: 0.4 };
      case 'intakeAirTemp':
        return { absolute: 10, ratio: 0.3 };
      case 'controlModuleVoltage':
        return { absolute: 0.6, ratio: 0.08 };
      default:
        return { absolute: 15, ratio: 0.3 };
    }
  }

  getKnockTendency(): 'Normal' | 'Caution' | 'No Data' {
    const timing = this.getPrimaryMetric('timingAdvance').current;
    const load = this.getPrimaryMetric('engineLoad').current;
    const rpm = this.getPrimaryMetric('rpm').current;

    if (timing === null || load === null || rpm === null) {
      return 'No Data';
    }

    // ノックセンサー値を直接読めない環境向けの簡易判定。
    // 高負荷/中高回転で点火時期が極端に低い場合を Caution とする。
    if (load >= 70 && rpm >= 2000 && timing <= 5) {
      return 'Caution';
    }

    return 'Normal';
  }
}