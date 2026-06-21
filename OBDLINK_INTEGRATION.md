# OBDLiNKEX Integration Guide

## Overview

このプロジェクトは、Electron + Angular + Node.js の組み合わせで、OBDLiNKEX ケーブルから車載 ECU のリアルタイムデータを取得し、モダンなタコメーター UI で表示します。

## Architecture

```
┌─────────────────────────────────────┐
│    Electron Main Process            │
│  ┌──────────────────────────────┐   │
│  │ OBDService (serialport)      │   │
│  │ - USB Auto Detection         │   │
│  │ - CAN/OBD-II Communication   │   │
│  │ - Real-time Data Parsing     │   │
│  └──────────────────────────────┘   │
└─────────────────┬───────────────────┘
                  │ IPC (Inter-Process Communication)
                  │
┌─────────────────▼───────────────────┐
│ Electron Renderer (Angular)         │
│  ┌──────────────────────────────┐   │
│  │ OBD Service (Observable)     │   │
│  │ - RxJS Data Stream           │   │
│  │ - Real-time UI Updates       │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ SpeedMeter Component         │   │
│  │ - Tachometer Visualization   │   │
│  │ - Engine Temp & Fuel Display │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## Hardware Setup

### OBDLiNKEX ケーブル接続
1. OBDLiNKEX ケーブルを車の OBD-II ポート（ダッシュボード下）に接続
2. USB Type-C → USB アダプタで PC に接続
3. 任意の USB ポートに接続可能（自動検出）

## Software Setup

### 1. Dependencies Installation

```bash
npm install electron serialport --save-dev
```

### 2. File Structure

```
car-manager/
├── electron/
│   ├── main.ts                # Electron メインプロセス
│   ├── obd-service.ts         # OBD/CAN 通信サービス
│   └── preload.ts             # IPC セキュア通信
├── src/
│   ├── services/
│   │   └── obd.service.ts     # Angular OBD サービス
│   └── app/
│       ├── app.ts             # App コンポーネント（OBD接続ボタン）
│       └── speed-meter/       # Tachometer UI
├── package.json               # Electron スクリプト追加
└── tsconfig.json              # TypeScript 設定
```

## Running the Application

### Development Mode

```bash
# Terminal 1: Watch Angular Build
npm run watch

# Terminal 2: Start Electron
npm run electron
```

### Or Single Command (requires build first)

```bash
npm run electron-dev
```

### Production Build

```bash
npm run electron-build
```

## Features Implemented

### ✅ USB Auto Detection
- 複数の USB ポートに自動対応
- OBDLiNKEX デバイス自動検出
- ポートが見つからない場合はエラー表示

### ✅ Real-time Data Streaming
- **Speed**: 0-240 km/h
- **RPM**: 0-7000 rpm
- **Engine Temperature**: -40°C ~ 215°C
- **Fuel Level**: 0-100%

### ✅ OBD-II Protocol Implementation
- ELM327 互換デバイスサポート
- PID リクエスト実装
- データパース & 検証

### ✅ Responsive UI
- Tachometer SVG Visualization
- Real-time Needle Animation
- Engine Info Display
- Connection Status Indicator

## OBD-II PID Mapping

| Label | PID | Description | Range |
|-------|-----|-------------|-------|
| Speed | 0x0D | Vehicle Speed | 0-255 km/h |
| RPM | 0x0C | Engine RPM | 0-16383.75 rpm |
| Engine Temp | 0x05 | Coolant Temperature | -40°C ~ +215°C |
| Fuel Level | 0x2F | Fuel Tank Level | 0-100% |

## Usage

1. **Start Application**
   ```bash
   npm run electron-dev
   ```

2. **Connect OBDLiNKEX**
   - Click "Connect OBD" button
   - Application auto-detects the device
   - Status changes to "Connected to OBDLiNKEX"

3. **View Real-time Data**
   - Tachometer needle moves with engine RPM
   - Speed displayed below tachometer
   - Engine temperature and fuel level shown in info section

4. **Disconnect**
   - Click "Disconnect" button
   - Connection status updates

## Troubleshooting

### 1. Port Not Found Error
- Check OBDLiNKEX cable connection
- Verify USB drivers installed
- Try different USB port

### 2. No Data Received
- Ensure vehicle is running
- Check OBD-II protocol compatibility
- Verify ELM327 initialization commands

### 3. Electron Not Starting
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run electron
```

## Extending the Application

### Add More OBD-II PIDs

Edit `electron/obd-service.ts`, `requestPIDLoop()` method:

```typescript
await this.requestPID('0104'); // Engine Load
await this.requestPID('010F'); // Intake Air Temp
```

### Update UI Components

Edit `src/app/speed-meter/speed-meter.html`:

```html
<div class="info-item">
  <span class="info-label">Intake Air Temp:</span>
  <span class="info-value">{{ intakeAirTemp }}°C</span>
</div>
```

## Notes

- **Electron Context Isolation**: Secure IPC communication via preload.ts
- **Type Safety**: Full TypeScript support for all components
- **Observable Pattern**: RxJS for reactive data binding
- **Auto-reconnect**: Consider implementing for production use

## Future Enhancements

- [ ] Data logging (CSV/Database)
- [ ] Trip statistics
- [ ] Alert thresholds (overheat, low fuel)
- [ ] Multiple vehicle profiles
- [ ] WebSocket remote monitoring
- [ ] Electron packager integration

## References

- [OBD-II Protocol](https://en.wikipedia.org/wiki/OBD-II_PIDs)
- [Electron Documentation](https://www.electronjs.org/docs)
- [serialport npm](https://serialport.io/)
