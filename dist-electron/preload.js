"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const obdApi = {
    // main プロセスの接続処理を呼び出す。
    connect: (portPath) => electron_1.ipcRenderer.invoke('obd:connect', portPath),
    // main プロセスの切断処理を呼び出す。
    disconnect: () => electron_1.ipcRenderer.invoke('obd:disconnect'),
    // 利用可能なシリアルポート一覧を取得する。
    listPorts: () => electron_1.ipcRenderer.invoke('obd:list-ports'),
    // main 側で定期監視ループを開始する。
    startMonitoring: (mode) => electron_1.ipcRenderer.invoke('obd:start-monitoring', mode),
    // 定期監視を停止する。
    stopMonitoring: () => electron_1.ipcRenderer.invoke('obd:stop-monitoring'),
    // main 側で利用可能な監視モード一覧を取得する。
    getSupportedModes: () => electron_1.ipcRenderer.invoke('obd:supported-modes'),
    // 接続中車両のVINを元に推定したプロフィールを取得する。
    getVehicleProfile: () => electron_1.ipcRenderer.invoke('vehicle:profile'),
    // SQLite/DuckDB の物理保存先を取得する。
    getStoragePaths: () => electron_1.ipcRenderer.invoke('storage:paths'),
    // ストレージ全体とDBごとの使用状況を取得する。
    getStorageOverview: () => electron_1.ipcRenderer.invoke('storage:overview'),
    // 予約容量をMB単位で設定する。
    setLogReservationMb: (reservationMb) => electron_1.ipcRenderer.invoke('storage:set-log-reservation', reservationMb),
    // 現在設定されている予約容量で再確保を試みる。
    reallocateReservation: () => electron_1.ipcRenderer.invoke('storage:reallocate-reservation'),
    // I/Oメトリクスの時系列を取得する。
    listIoMetrics: (range) => electron_1.ipcRenderer.invoke('storage:io-metrics', range),
    // 既知車種マスタの一覧を取得する。
    listKnownVehicles: () => electron_1.ipcRenderer.invoke('vehicles:list-known'),
    // 既知車種マスタへ登録または更新する。
    upsertKnownVehicle: (payload) => electron_1.ipcRenderer.invoke('vehicles:upsert-known', payload),
    // 既知車種マスタから削除する。
    deleteKnownVehicle: (id) => electron_1.ipcRenderer.invoke('vehicles:delete-known', id),
    // 接続履歴一覧を取得する。
    listConnectionHistory: () => electron_1.ipcRenderer.invoke('history:list-connections'),
    // DuckDB の走行ログ一覧を取得する。
    listDriveLogs: (limit) => electron_1.ipcRenderer.invoke('drive-logs:list', limit),
    onConnectionState: (callback) => {
        electron_1.ipcRenderer.on('obd:connection-state', (event, state) => {
            callback(state);
        });
        return () => {
            electron_1.ipcRenderer.removeAllListeners('obd:connection-state');
        };
    },
    onOBDData: (callback) => {
        // main プロセスから送られてくるリアルタイムデータを購読する。
        electron_1.ipcRenderer.on('obd:data', (event, data) => {
            callback(data);
        });
        // Angular 側の破棄時に購読解除できるよう、解除関数を返す。
        return () => {
            electron_1.ipcRenderer.removeAllListeners('obd:data');
        };
    },
};
// window.obdApi として renderer 側へ公開する。
// これにより Angular は preload 経由でのみ main の機能に触れられる。
electron_1.contextBridge.exposeInMainWorld('obdApi', obdApi);
//# sourceMappingURL=preload.js.map