"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const obd_service_1 = require("./obd-service");
const vehicle_info_service_1 = require("./vehicle-info-service");
// 開発モード判定
const isDev = process.env.NODE_ENV === 'development';
// ホットリロード対応（開発時のみ）
if (isDev) {
    try {
        require('electron-reload')(__dirname, {
            electron: path.join(__dirname, '../node_modules/.bin/electron'),
            electronArgv: ['--inspect=5858'],
            hardResetMethod: 'exit',
            // main / preload / service のコンパイル結果が変わったら Electron を再起動する。
            // Angular 側の変更は ng serve のライブリロードに任せる。
            forceHardReset: true,
            delay: 500,
        });
    }
    catch (e) {
        console.log('electron-reload がロードできません:', e);
    }
}
let mainWindow;
let obdService;
let vehicleInfoService;
let activeConnectionId = null;
let pendingConnectedAt = null;
let activeDriveVehicle = null;
let driveLogWriteChain = Promise.resolve();
function isDuckDbConnectionError(error) {
    const message = String(error?.message ?? error ?? '').toLowerCase();
    const code = String(error?.code ?? '').toUpperCase();
    const errorType = String(error?.errorType ?? '').toLowerCase();
    return (code.includes('DUCKDB')
        && (errorType.includes('connection')
            || message.includes('connection was never established')
            || message.includes('has been closed already')));
}
async function appendDriveLogWithRetry(payload, maxAttempts = 4) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await vehicleInfoService.appendDriveLog(payload);
            return;
        }
        catch (error) {
            const isLastAttempt = attempt === maxAttempts;
            if (!isDuckDbConnectionError(error) || isLastAttempt) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
        }
    }
}
function buildFallbackDriveLogVin(portPath, mode, connectedAtIso) {
    const compactTime = connectedAtIso.replace(/[-:TZ.]/g, '').slice(0, 14) || String(Date.now());
    const safePort = (portPath ?? 'unknown-port').replace(/[^A-Za-z0-9]+/g, '_').slice(-24);
    const safeMode = mode.replace(/[^A-Za-z0-9]+/g, '_');
    return `SESSION_${safeMode}_${safePort}_${compactTime}`;
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    // 開発時は http://localhost:4200 へ接続
    // ビルド時は dist フォルダから起動
    const devUrl = 'http://localhost:4200';
    const fileUrl = `file://${path.join(__dirname, '../dist/car-manager/browser/index.html')}`;
    if (isDev) {
        mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
            if (validatedURL?.startsWith(devUrl)) {
                console.error(`Failed to load ${devUrl}: [${errorCode}] ${errorDescription}. Falling back to built index.`);
                void mainWindow?.loadURL(fileUrl);
            }
        });
        void mainWindow.loadURL(devUrl).catch((error) => {
            console.error(`Failed to load ${devUrl}:`, error);
            return mainWindow?.loadURL(fileUrl);
        });
    }
    else {
        void mainWindow.loadURL(fileUrl);
    }
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.on('ready', () => {
    createWindow();
    // OBD サービス初期化
    obdService = new obd_service_1.OBDService();
    vehicleInfoService = new vehicle_info_service_1.VehicleInfoService();
    obdService.onConnectionLost(async (reason) => {
        if (activeConnectionId) {
            vehicleInfoService.finishConnectionHistory(activeConnectionId, reason);
            activeConnectionId = null;
        }
        mainWindow?.webContents.send('obd:connection-state', {
            connected: false,
            reason,
        });
        activeDriveVehicle = null;
        await obdService.disconnect();
    });
    // IPC ハンドラ登録
    electron_1.ipcMain.handle('obd:connect', async (_event, portPath) => {
        pendingConnectedAt = new Date().toISOString();
        try {
            await obdService.connect(portPath);
            return { success: true, message: 'OBDLiNKEX に接続しました' };
        }
        catch (error) {
            pendingConnectedAt = null;
            return { success: false, message: String(error) };
        }
    });
    electron_1.ipcMain.handle('obd:disconnect', async () => {
        try {
            if (activeConnectionId) {
                vehicleInfoService.finishConnectionHistory(activeConnectionId, 'user-disconnect');
                activeConnectionId = null;
            }
            await obdService.disconnect();
            pendingConnectedAt = null;
            return { success: true, message: 'OBDLiNKEX から切断しました' };
        }
        catch (error) {
            return { success: false, message: String(error) };
        }
    });
    electron_1.ipcMain.handle('obd:start-monitoring', async (event, mode) => {
        try {
            if (!activeConnectionId) {
                const resolvedMode = mode ?? 'obd2-standard';
                const connectedAt = pendingConnectedAt ?? new Date().toISOString();
                const connectedPortPath = obdService.getConnectedPortPath();
                const vin = await obdService.getVIN();
                if (!vin) {
                    return {
                        success: false,
                        message: 'VIN を取得できないため監視を開始できません。配線/イグニッション状態/接続モードを確認してください。',
                    };
                }
                const profile = vehicleInfoService.resolveVehicleIdentity(vin);
                const driveLogVin = profile.vin ?? buildFallbackDriveLogVin(connectedPortPath, resolvedMode, connectedAt);
                activeDriveVehicle = {
                    vin: driveLogVin,
                    manufacturer: profile.manufacturer,
                    model: profile.model,
                    mode: resolvedMode,
                    portPath: connectedPortPath,
                };
                activeConnectionId = vehicleInfoService.startConnectionHistory({
                    vin: profile.vin,
                    manufacturer: profile.manufacturer,
                    model: profile.model,
                    mode: resolvedMode,
                    portPath: connectedPortPath,
                    connectedAt,
                });
                pendingConnectedAt = null;
            }
            obdService.startMonitoring((data) => {
                mainWindow?.webContents.send('obd:data', data);
                const driveVehicle = activeDriveVehicle;
                if (driveVehicle) {
                    const snapshot = data;
                    const sampledOrNull = (field, value) => {
                        const sampled = Boolean(snapshot.sampledFields?.[field]);
                        return sampled && Number.isFinite(value) ? value : Number.NaN;
                    };
                    const payload = {
                        vin: driveVehicle.vin,
                        sampleTimestampMs: snapshot.timestamp,
                        manufacturer: driveVehicle.manufacturer,
                        model: driveVehicle.model,
                        mode: driveVehicle.mode,
                        portPath: driveVehicle.portPath,
                        // 同値はそのまま保存し、当該秒で未取得の項目は NULL で保持する。
                        speed: sampledOrNull('speed', snapshot.speed),
                        rpm: sampledOrNull('rpm', snapshot.rpm),
                        engineTemp: sampledOrNull('engineTemp', snapshot.engineTemp),
                        engineOilTemp: sampledOrNull('engineOilTemp', snapshot.engineOilTemp),
                        atfTemp: sampledOrNull('atfTemp', snapshot.atfTemp),
                        fuelLevel: sampledOrNull('fuelLevel', snapshot.fuelLevel),
                        engineLoad: sampledOrNull('engineLoad', snapshot.engineLoad),
                        throttlePosition: sampledOrNull('throttlePosition', snapshot.throttlePosition),
                        timingAdvance: sampledOrNull('timingAdvance', snapshot.timingAdvance),
                        intakeAirTemp: sampledOrNull('intakeAirTemp', snapshot.intakeAirTemp),
                        manifoldPressure: sampledOrNull('manifoldPressure', snapshot.manifoldPressure),
                        maf: sampledOrNull('maf', snapshot.maf),
                        controlModuleVoltage: sampledOrNull('controlModuleVoltage', snapshot.controlModuleVoltage),
                    };
                    driveLogWriteChain = driveLogWriteChain
                        .then(() => appendDriveLogWithRetry(payload))
                        .catch((error) => {
                        console.error('DuckDB drive log write failed:', error);
                    });
                }
            }, mode ?? 'obd2-standard');
            return { success: true };
        }
        catch (error) {
            return { success: false, message: String(error) };
        }
    });
    electron_1.ipcMain.handle('obd:supported-modes', async () => {
        return obdService.getSupportedModes();
    });
    electron_1.ipcMain.handle('vehicle:profile', async () => {
        try {
            const vin = await obdService.getVIN();
            return vehicleInfoService.resolveVehicleIdentity(vin);
        }
        catch (error) {
            return {
                vin: null,
                manufacturer: 'Unknown',
                model: 'Unknown',
                modelYear: 'Unknown',
                engineCode: 'Unknown',
                confidence: 'low',
                error: String(error),
            };
        }
    });
    electron_1.ipcMain.handle('storage:paths', async () => {
        try {
            return vehicleInfoService.getStoragePaths();
        }
        catch (error) {
            console.error('storage:paths failed:', error);
            return null;
        }
    });
    electron_1.ipcMain.handle('storage:overview', async () => {
        try {
            return vehicleInfoService.getStorageOverview();
        }
        catch (error) {
            console.error('storage:overview failed:', error);
            return null;
        }
    });
    electron_1.ipcMain.handle('storage:set-log-reservation', async (_event, reservationMb) => {
        try {
            return vehicleInfoService.setLogReservationMb(reservationMb);
        }
        catch (error) {
            return { success: false, message: String(error) };
        }
    });
    electron_1.ipcMain.handle('storage:reallocate-reservation', async () => {
        try {
            return vehicleInfoService.reallocateLogReservation();
        }
        catch (error) {
            return { success: false, message: String(error) };
        }
    });
    electron_1.ipcMain.handle('storage:io-metrics', async (_event, range) => {
        try {
            return await vehicleInfoService.listIoMetricSamples(range);
        }
        catch (error) {
            console.error('storage:io-metrics failed:', error);
            return [];
        }
    });
    electron_1.ipcMain.handle('vehicles:list-known', async () => {
        return vehicleInfoService.listKnownVehicles();
    });
    electron_1.ipcMain.handle('vehicles:upsert-known', async (event, payload) => {
        return vehicleInfoService.upsertKnownVehicle(payload);
    });
    electron_1.ipcMain.handle('vehicles:delete-known', async (event, id) => {
        return vehicleInfoService.deleteKnownVehicle(id);
    });
    electron_1.ipcMain.handle('history:list-connections', async () => {
        return vehicleInfoService.listConnectionHistory();
    });
    electron_1.ipcMain.handle('drive-logs:list', async (_event, limit) => {
        return vehicleInfoService.listDriveLogs(limit);
    });
    electron_1.ipcMain.handle('obd:stop-monitoring', async () => {
        obdService.stopMonitoring();
        return { success: true };
    });
    electron_1.ipcMain.handle('obd:list-ports', async () => {
        return obdService.listPorts();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});
// アプリ終了時にOBDサービスをクリーンアップ
electron_1.app.on('before-quit', async () => {
    if (vehicleInfoService) {
        vehicleInfoService.dispose();
    }
    if (obdService) {
        await obdService.disconnect();
    }
});
//# sourceMappingURL=main.js.map