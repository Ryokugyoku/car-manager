import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ScaleLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

@Component({
  selector: 'app-speed-meter',
  imports: [CommonModule],
  templateUrl: './speed-meter.html',
  styleUrls: ['./speed-meter.css'],
})
export class SpeedMeter {
  @Input() speed = 0;
  @Input() rpm = 0;
  @Input() engineTemp = 0;
  @Input() fuelLevel = 0;
  @Input() isConnected = false;
  @Input() connectionStatus = 'Not Connected';
  scaleLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  constructor() {
    this.generateScaleLines();
  }

  // スケール線を生成
  generateScaleLines() {
    this.scaleLines = [];
    for (let i = 0; i < 7; i++) {
      const angle = (i * 270 / 7 - 135) * Math.PI / 180;
      const x1 = 100 + 80 * Math.cos(angle);
      const y1 = 100 + 80 * Math.sin(angle);
      const x2 = 100 + 90 * Math.cos(angle);
      const y2 = 100 + 90 * Math.sin(angle);
      this.scaleLines.push({ x1, y1, x2, y2 });
    }
  }

  // タコメーターの角度を計算（-135度から135度の範囲）
  get tachometerAngle(): number {
    // RPMを0～7000の範囲に正規化してから-135～135度にマップ
    const normalizedRpm = Math.min(this.rpm, 7000);
    return (normalizedRpm / 7000) * 270 - 135;
  }

  increase() {
    if (this.speed < 240) {
      this.speed += 10;
    }
    if (this.rpm < 7000) {
      this.rpm += 1000;
    }
  }

  decrease() {
    if (this.speed > 0) {
      this.speed -= 10;
    }
    if (this.rpm > 0) {
      this.rpm -= 1000;
    }
  }
}
