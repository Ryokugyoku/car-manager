"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBDService = void 0;
const serialport_1 = require("serialport");
const parser_readline_1 = require("@serialport/parser-readline");
class OBDService {
    constructor() {
        // 実際の車両と通信するシリアルポート本体。
        // 接続確立後に write/pipe/on を通じて ELM327 互換のATコマンドやPIDを送受信する。
        this.port = null;
        // 1行単位でレスポンスを受け取るためのパーサー。
        // OBD応答は ">" で終端したり複数のHEXバイトが並ぶため、行分割後に処理する。
        this.parser = null;
        // モニタリングループの実行状態。
        // true の間は PID を順番に要求し続ける。
        this.isMonitoring = false;
        // 取得した車両データを UI 側へ渡すためのコールバック。
        // Electron main -> preload -> Angular の流れの中で、main 側からレンダラーへ通知する入口になる。
        this.monitoringCallback = null;
        // 1サイクルの中で取得できた値を一時的に保持するキャッシュ。
        // 全PIDが同じタイミングで返るとは限らないため、受信ごとに部分更新する。
        this.dataCache = {};
        // 画面表示へ最後に流したデータ。
        // 今回のループで一部PIDが欠けても、前回値を維持しながら更新するために使う。
        this.lastEmittedData = {
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
            sampledFields: {},
            timestamp: Date.now(),
        };
        // PID要求は応答を受信するまで次へ進めず、1巡が完了した時点で配信する。
        this.requestTimer = null;
        this.requestInFlight = false;
        this.pidCursor = 0;
        this.pendingRequest = null;
        this.requestLoopGeneration = 0;
        // 「>」受信後にだけ次へ進むため、固定待ちは入れずアダプタの処理速度に追従する。
        this.interRequestDelayMs = 0;
        // シリアルへの書き込みではなくECU応答を待つため、低速な車両にも余裕を持たせる。
        this.responseTimeoutMs = 3000;
        // NO DATA が続く猶予時間。瞬間的な通信揺れで切断扱いにしない。
        this.noDataGraceMs = 15000;
        // 監視プロファイル。将来的に ASC カプラー専用モードを増やしやすい構造。
        this.profiles = {
            'obd2-standard': {
                mode: 'obd2-standard',
                // 標準モードでも油温/ATF温を取得できるように拡張PIDを含める。
                // NO DATA 連続時の切断判定は猶予時間付きなので、拡張PID混在でも接続が落ちにくい。
                pids: ['010D', '010C', '0105', '015C', '010D', '010F', '0110', '0104', '0111', '010D', '010E', '010B', '012F', '0142', '2101', '221017'],
            },
            'asc-coupler': {
                mode: 'asc-coupler',
                // 現段階では ASC カプラー経由でも標準 OBD-II PID を巡回し、
                // ダッシュボードの既存項目（速度/RPM/温度など）を表示可能にする。
                // 将来 ASC 専用 PID が判明したら、ここを差し替えるだけで拡張できる。
                pids: ['010D', '010C', '0105', '015C', '010D', '010F', '0110', '0104', '0111', '010D', '010E', '010B', '012F', '0142', '2101', '221017'],
            },
        };
        this.currentMode = 'obd2-standard';
        // macOS の内部TTYや、今回の車両接続に関係しない疑似ポートを除外するためのパターン。
        this.ignoredPortPatterns = [
            /tty\.debug-console/i,
            /tty\.console/i,
            /tty\.Bluetooth/i,
            /tty\.iPhone/i,
        ];
        this.cachedVin = null;
        this.connectedPortPath = null;
        this.noDataStreak = 0;
        this.lastSuccessfulRxAt = 0;
        this.connectionLostNotified = false;
        this.onConnectionLostCallback = null;
    }
    onConnectionLost(callback) {
        this.onConnectionLostCallback = callback;
    }
    getConnectedPortPath() {
        return this.connectedPortPath;
    }
    /**
     * 利用可能なシリアルポートを列挙する。
     * ここでは接続は行わず、PCに見えている候補一覧だけを返す。
     * vendorId / productId / manufacturer を上位レイヤーで使えるようにしている。
     */
    async listPorts() {
        try {
            const ports = await serialport_1.SerialPort.list();
            return ports.map((port) => ({
                path: port.path,
                manufacturer: port.manufacturer || 'Unknown',
                productId: port.productId,
                vendorId: port.vendorId,
            }));
        }
        catch (error) {
            throw new Error(`ポート列挙エラー: ${error}`);
        }
    }
    /**
     * OBDLink EX デバイスを検出して接続する。
     * 引数でポートが指定されない場合は、自動検出ロジックで最も可能性が高いポートを選ぶ。
     */
    async connect(portPath) {
        try {
            if (!portPath) {
                // 自動検出モードでは、まず列挙結果から内部TTYを除外し、その後に候補をスコアリングする。
                const ports = await this.listPorts();
                const preferredPort = this.choosePreferredPort(ports);
                if (!preferredPort) {
                    throw new Error('利用可能なシリアルポートが見つかりません');
                }
                portPath = preferredPort.path;
                console.log('検出したシリアルポート:', ports);
                console.log(`接続するポート: ${portPath}`);
            }
            // SerialPort を開き、OBDLink EX とのバイト列送受信を開始する。
            this.port = new serialport_1.SerialPort({
                path: portPath,
                baudRate: 115200, // OBDLiNKEX の標準ボーレート
            });
            this.connectedPortPath = portPath;
            this.connectionLostNotified = false;
            this.noDataStreak = 0;
            this.lastSuccessfulRxAt = Date.now();
            // レスポンスは 1 行単位で扱うので、キャリッジリターン区切りで行パースする。
            this.parser = this.port.pipe(new parser_readline_1.ReadlineParser({ delimiter: '\r' }));
            this.parser.on('data', (line) => {
                this.handleDataLine(line);
            });
            // ELM/OBDLink は「>」を返した時点で1コマンドの処理が完了する。
            // PIDデータ行だけで次要求へ進むと、複数行応答の途中やプロンプト直前に
            // 次コマンドを送って取りこぼすことがあるため、生データ側で終端を検知する。
            this.port.on('data', (chunk) => {
                if (chunk.includes(0x3e)) {
                    this.completePendingRequest();
                }
            });
            this.port.on('error', (error) => {
                console.error(`シリアルポートエラー: ${error}`);
                this.notifyConnectionLost('serial-error');
            });
            this.port.on('close', () => {
                this.notifyConnectionLost('port-lost');
            });
            // ELM327 互換アダプタの初期化。
            // リセット、エコー無効、ヘッダー非表示、タイミング有効化、自動プロトコル選択を行う。
            await this.initializeOBD();
            // 接続時にVINを1回取得してキャッシュしておく。
            this.cachedVin = await this.readVIN();
            return { success: true, path: portPath };
        }
        catch (error) {
            throw new Error(`接続エラー: ${error}`);
        }
    }
    /**
      * 接続を切断する。
      * モニタリングループを止めてからポートを閉じることで、通信中断時の不整合を避ける。
     */
    async disconnect() {
        if (this.isMonitoring) {
            this.stopMonitoring();
        }
        if (this.port) {
            this.port.close();
            this.port = null;
        }
        this.cachedVin = null;
        this.connectedPortPath = null;
        this.noDataStreak = 0;
        this.lastSuccessfulRxAt = 0;
        this.connectionLostNotified = false;
    }
    async getVIN() {
        if (this.cachedVin) {
            return this.cachedVin;
        }
        // 監視中に VIN を読むと通常PIDとレスポンスが混ざるため、一時停止して取得する。
        const wasMonitoring = this.isMonitoring;
        if (wasMonitoring) {
            this.stopTimers();
            this.requestInFlight = false;
        }
        this.cachedVin = await this.readVINWithRetry();
        if (wasMonitoring && this.monitoringCallback) {
            this.startRequestLoop();
        }
        return this.cachedVin;
    }
    async readVINWithRetry() {
        const commands = ['0902', '09 02'];
        for (const command of commands) {
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const vin = await this.readVIN(command);
                if (vin) {
                    return vin;
                }
                await new Promise((resolve) => setTimeout(resolve, 220));
            }
        }
        return null;
    }
    /**
      * 車両データの定期取得を開始する。
      * 呼び出し元から渡されたコールバックへ、取得済みのOBDデータを一定周期で通知する。
     */
    startMonitoring(callback, mode = 'obd2-standard') {
        this.currentMode = mode;
        this.monitoringCallback = callback;
        this.isMonitoring = true;
        this.dataCache = {};
        this.pidCursor = 0;
        this.requestInFlight = false;
        this.noDataStreak = 0;
        this.lastSuccessfulRxAt = Date.now();
        this.startRequestLoop();
    }
    /**
     * 車両データの定期取得を停止する。
     * 次回ループの継続条件を false にするだけで、現在の送受信は自然終了させる。
     */
    stopMonitoring() {
        this.isMonitoring = false;
        this.monitoringCallback = null;
        this.stopTimers();
    }
    /**
     * 利用可能な監視モード一覧を返す。
     * UI から将来的にモード選択を可能にするための拡張ポイント。
     */
    getSupportedModes() {
        return Object.keys(this.profiles);
    }
    /**
      * ELM327 初期化。
      * OBDLink EX は ELM327 互換なので、AT コマンドで通信挙動を整える。
     */
    async initializeOBD() {
        if (!this.port)
            return;
        const commands = [
            'AT Z', // アダプタの状態を初期化する
            'AT E0', // 送信コマンドのエコーを切って、受信解析を単純化する
            'AT H0', // ヘッダーを消して、レスポンスの揺れを減らす
            'AT L0', // ラインフィードを抑制し、改行解析を安定させる
            'AT AL', // 長いレスポンス(例: VIN)を受け取れるようにする
            'AT AT 1', // レスポンス待ち時間を自動調整する
            'AT SP 0', // 車両のプロトコルを自動判定させる
        ];
        for (const cmd of commands) {
            await this.sendCommand(cmd);
            // 初期化コマンドの返答を待つ。
            // ここを短くしすぎると、後続コマンドが前の応答に重なる。
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    /**
     * Mode 09 PID 02 からVINを取得する。
     * 返却形式が複数フレームに分かれるため、ASCII化した後に17桁へ正規化する。
     */
    async readVIN(command = '09 02') {
        if (!this.port || !this.parser) {
            return null;
        }
        return new Promise((resolve) => {
            const chunks = [];
            let hasVinStartFrame = false;
            let settled = false;
            const finish = (value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                this.parser?.off('data', onData);
                resolve(value);
            };
            const onData = (line) => {
                const tokens = line.match(/[0-9A-Fa-f]{2}/g)?.map((v) => v.toUpperCase()) ?? [];
                const idx = tokens.indexOf('49');
                if (idx !== -1 && tokens.length > idx + 2 && tokens[idx + 1] === '02') {
                    hasVinStartFrame = true;
                    for (let i = idx + 3; i < tokens.length; i += 1) {
                        chunks.push(tokens[i]);
                    }
                }
                else if (hasVinStartFrame) {
                    // ISO-TP 継続フレーム (21,22,23...) を拾う。
                    const continuationIndex = tokens.findIndex((token) => /^2[1-9A-F]$/.test(token));
                    if (continuationIndex !== -1) {
                        for (let i = continuationIndex + 1; i < tokens.length; i += 1) {
                            chunks.push(tokens[i]);
                        }
                    }
                    else if (/^[0-9A-F]+:\s*/i.test(line)) {
                        // OBDLink系で見られる「0: ...」「1: ...」「2: ...」形式にも対応する。
                        const payload = line.replace(/^[0-9A-F]+:\s*/i, '');
                        const payloadTokens = payload.match(/[0-9A-Fa-f]{2}/g)?.map((v) => v.toUpperCase()) ?? [];
                        for (const token of payloadTokens) {
                            chunks.push(token);
                        }
                    }
                }
                const ascii = chunks
                    .map((h) => String.fromCharCode(parseInt(h, 16)))
                    .join('')
                    .replace(/[^A-Z0-9]/g, '');
                if (ascii.length >= 17) {
                    finish(ascii.slice(0, 17));
                }
            };
            const timeoutId = setTimeout(() => {
                if (chunks.length === 0) {
                    finish(null);
                    return;
                }
                const ascii = chunks
                    .map((h) => String.fromCharCode(parseInt(h, 16)))
                    .join('')
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 17);
                // 一部ECUはVINの後半のみ返すことがあるため、短くても保持して上位で推定に使う。
                finish(ascii.length >= 6 ? ascii : null);
            }, 5000);
            this.parser?.on('data', onData);
            this.port?.write(`${command}\r`, () => {
                // write callbackは不要。timeoutで回収する。
            });
        });
    }
    /**
     * OBD コマンド送信。
     * 文字列末尾に CR を付けて ELM327 に 1 コマンドとして送る。
     */
    sendCommand(command) {
        return new Promise((resolve) => {
            if (!this.port) {
                resolve();
                return;
            }
            this.port.write(`${command}\r`, () => {
                resolve();
            });
        });
    }
    /**
     * PID要求ループ（ラウンドロビン）。
     * ELM/OBDLink のコマンド完了後にだけ次の PID を要求する。
     */
    startRequestLoop() {
        this.stopRequestTimer();
        const generation = this.requestLoopGeneration;
        const runNext = async () => {
            if (!this.isMonitoring || generation !== this.requestLoopGeneration) {
                return;
            }
            await this.requestNextPid();
            if (!this.isMonitoring || generation !== this.requestLoopGeneration) {
                return;
            }
            this.requestTimer = setTimeout(() => {
                void runNext();
            }, this.interRequestDelayMs);
        };
        this.requestTimer = setTimeout(() => {
            void runNext();
        }, 0);
    }
    async requestNextPid() {
        if (!this.isMonitoring || !this.port || this.requestInFlight) {
            return;
        }
        const profile = this.profiles[this.currentMode] ?? this.profiles['obd2-standard'];
        if (!profile.pids.length) {
            return;
        }
        const pid = profile.pids[this.pidCursor];
        this.pidCursor = (this.pidCursor + 1) % profile.pids.length;
        this.requestInFlight = true;
        try {
            await this.requestPID(pid);
        }
        catch (error) {
            console.error(`[OBD TX ERROR] pid=${pid}`, error);
        }
        finally {
            this.requestInFlight = false;
        }
        // 最後のPIDの応答（NO DATA/タイムアウトを含む）まで待ってから、1巡分を1件として配信する。
        if (this.isMonitoring && this.pidCursor === 0) {
            this.publishSnapshot();
        }
    }
    publishSnapshot() {
        if (!this.isMonitoring) {
            return;
        }
        const sampledFields = {};
        for (const key of Object.keys(this.dataCache)) {
            sampledFields[key] = true;
        }
        this.lastEmittedData = {
            speed: this.dataCache.speed ?? this.lastEmittedData.speed,
            rpm: this.dataCache.rpm ?? this.lastEmittedData.rpm,
            engineTemp: this.dataCache.engineTemp ?? this.lastEmittedData.engineTemp,
            engineOilTemp: this.dataCache.engineOilTemp ?? this.lastEmittedData.engineOilTemp,
            atfTemp: this.dataCache.atfTemp ?? this.lastEmittedData.atfTemp,
            fuelLevel: this.dataCache.fuelLevel ?? this.lastEmittedData.fuelLevel,
            engineLoad: this.dataCache.engineLoad ?? this.lastEmittedData.engineLoad,
            throttlePosition: this.dataCache.throttlePosition ?? this.lastEmittedData.throttlePosition,
            timingAdvance: this.dataCache.timingAdvance ?? this.lastEmittedData.timingAdvance,
            intakeAirTemp: this.dataCache.intakeAirTemp ?? this.lastEmittedData.intakeAirTemp,
            manifoldPressure: this.dataCache.manifoldPressure ?? this.lastEmittedData.manifoldPressure,
            maf: this.dataCache.maf ?? this.lastEmittedData.maf,
            controlModuleVoltage: this.dataCache.controlModuleVoltage ?? this.lastEmittedData.controlModuleVoltage,
            sampledFields,
            timestamp: Date.now(),
        };
        if (this.monitoringCallback) {
            this.monitoringCallback(this.lastEmittedData);
        }
        this.dataCache = {};
    }
    stopTimers() {
        this.stopRequestTimer();
        this.pendingRequest?.finish();
    }
    stopRequestTimer() {
        this.requestLoopGeneration += 1;
        if (this.requestTimer) {
            clearTimeout(this.requestTimer);
            this.requestTimer = null;
        }
    }
    /**
      * PID を 1つ要求する。
      * 例: 010C = RPM, 010D = 速度。
     */
    requestPID(pid) {
        return new Promise((resolve) => {
            if (!this.port) {
                resolve();
                return;
            }
            // シリアルドライバ都合で callback が返らないケースに備え、必ずタイムアウトで解放する。
            let settled = false;
            const finish = () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    if (this.pendingRequest?.finish === finish) {
                        this.pendingRequest = null;
                    }
                    resolve();
                }
            };
            const timeoutId = setTimeout(() => {
                console.warn(`[OBD RX TIMEOUT] pid=${pid}`);
                // イグニッションOFF後は ELM327 が "NO DATA" を返さず、単に無応答になる車両がある。
                // タイムアウトも ECU 応答失敗として数えないと、そのケースでは接続断を検知できない。
                this.recordEcuResponseFailure();
                finish();
            }, this.responseTimeoutMs);
            // write完了ではなく、ELM/OBDLink の「>」受信を要求完了とする。
            this.pendingRequest = { finish };
            this.port.write(`${pid}\r`, (error) => {
                if (error) {
                    console.error(`[OBD TX ERROR] pid=${pid}`, error);
                    finish();
                }
            });
        });
    }
    /**
     * シリアル受信した1行を解析する。
     * ヘッダー有無やスペース有無が混在しても、HEXバイト列として抽出して判定する。
     */
    handleDataLine(line) {
        // 前コマンドのプロンプトが次の行頭へ残る機器があるため、先頭の > だけ除去する。
        const trimmed = line.trim().replace(/^>+\s*/, '');
        if (!trimmed || trimmed === 'OK') {
            // プロンプトや単純な OK 応答はデータではないので捨てる。
            return;
        }
        // 受信ログはデバッグ用。
        // 実機でのプロトコル違い調査時に、どんな生レスポンスが来ているかを追えるようにする。
        console.log('[OBD RX]', trimmed);
        if (trimmed === 'NO DATA' || trimmed === 'STOPPED' || trimmed === 'UNABLE TO CONNECT') {
            this.recordEcuResponseFailure();
            return;
        }
        // 文字列から 2桁HEX の並びだけを抜き出す。
        // これで「7E8 04 41 0C 0A F2」のようなヘッダー付き応答でも、「41 0C 0A F2」でも同じ処理になる。
        const bytes = trimmed.match(/[0-9A-Fa-f]{2}/g)?.map((token) => token.toUpperCase()) ?? [];
        // モード01標準PID: 41 xx ...
        const mode01Index = bytes.indexOf('41');
        if (mode01Index !== -1 && bytes.length > mode01Index + 2) {
            this.noDataStreak = 0;
            this.lastSuccessfulRxAt = Date.now();
            const pid = bytes[mode01Index + 1];
            const data1 = parseInt(bytes[mode01Index + 2], 16);
            const data2 = bytes[mode01Index + 3] ? parseInt(bytes[mode01Index + 3], 16) : 0;
            switch (pid) {
                case '0D': // 速度 = 1バイトそのまま km/h
                    this.dataCache.speed = data1;
                    break;
                case '0C': // 回転数 = (A * 256 + B) / 4
                    this.dataCache.rpm = Math.round((data1 * 256 + data2) / 4);
                    break;
                case '05': // 冷却水温 = A - 40
                    this.dataCache.engineTemp = data1 - 40;
                    break;
                case '5C': // エンジンオイル温 = A - 40（標準PID）
                    this.dataCache.engineOilTemp = data1 - 40;
                    break;
                case '0F': // 吸気温 = A - 40
                    this.dataCache.intakeAirTemp = data1 - 40;
                    break;
                case '10': // MAF = (A * 256 + B) / 100 g/s
                    this.dataCache.maf = (data1 * 256 + data2) / 100;
                    break;
                case '04': // エンジン負荷 = A / 255 * 100
                    this.dataCache.engineLoad = Math.round((data1 / 255) * 100);
                    break;
                case '11': // スロットル開度 = A / 255 * 100
                    this.dataCache.throttlePosition = Math.round((data1 / 255) * 100);
                    break;
                case '0E': // 点火時期 = A/2 - 64 [deg BTDC]
                    this.dataCache.timingAdvance = Math.round((data1 / 2 - 64) * 10) / 10;
                    break;
                case '0B': // 吸気管絶対圧 = A kPa
                    this.dataCache.manifoldPressure = data1;
                    break;
                case '2F': // 燃料残量 = A / 255 * 100
                    this.dataCache.fuelLevel = Math.round((data1 / 255) * 100);
                    break;
                case '42': // 制御モジュール電圧 = (A * 256 + B) / 1000 V
                    this.dataCache.controlModuleVoltage = (data1 * 256 + data2) / 1000;
                    break;
            }
            return;
        }
        // Subaru独自 2101: 61 01 A ... (油温)
        const mode21Index = bytes.indexOf('61');
        if (mode21Index !== -1 && bytes.length > mode21Index + 2 && bytes[mode21Index + 1] === '01') {
            this.noDataStreak = 0;
            this.lastSuccessfulRxAt = Date.now();
            const payload = bytes.slice(mode21Index + 2, mode21Index + 6);
            const decoded = this.decodeTemperaturePayload(payload, this.dataCache.engineTemp ?? this.lastEmittedData.engineTemp);
            if (decoded !== null) {
                this.dataCache.engineOilTemp = decoded;
            }
            return;
        }
        // 独自 221017: 返却形式の揺れに備え、複数パターンを吸収する。
        // 例: 62 10 17 A / 62 10 17 A B / 62 22 10 17 A ...
        const atfValue = this.parseAtfTemperature(bytes);
        if (atfValue !== null) {
            this.noDataStreak = 0;
            this.lastSuccessfulRxAt = Date.now();
            this.dataCache.atfTemp = atfValue;
        }
    }
    recordEcuResponseFailure() {
        if (!this.isMonitoring) {
            return;
        }
        this.noDataStreak += 1;
        const elapsedSinceLastRx = Date.now() - this.lastSuccessfulRxAt;
        if (this.noDataStreak >= 5 && elapsedSinceLastRx >= this.noDataGraceMs) {
            this.notifyConnectionLost('ignition-off');
        }
    }
    completePendingRequest() {
        const pending = this.pendingRequest;
        if (!pending) {
            return;
        }
        pending.finish();
    }
    parseAtfTemperature(bytes) {
        const candidates = [
            { pattern: ['62', '10', '17'], valueOffset: 3 },
            { pattern: ['62', '22', '10', '17'], valueOffset: 4 },
            { pattern: ['10', '17'], valueOffset: 2 },
        ];
        for (const candidate of candidates) {
            const startIndex = this.findPatternIndex(bytes, candidate.pattern);
            if (startIndex === -1) {
                continue;
            }
            const rawIndex = startIndex + candidate.valueOffset;
            if (bytes.length <= rawIndex) {
                continue;
            }
            const payload = bytes.slice(rawIndex, rawIndex + 4);
            const decoded = this.decodeTemperaturePayload(payload, this.dataCache.engineTemp ?? this.lastEmittedData.engineTemp);
            if (decoded !== null) {
                return decoded;
            }
        }
        return null;
    }
    decodeTemperaturePayload(payloadBytes, coolantTemp) {
        if (!payloadBytes.length) {
            return null;
        }
        const parsed = payloadBytes
            .map((token) => parseInt(token, 16))
            .filter((value) => Number.isFinite(value));
        if (!parsed.length) {
            return null;
        }
        const candidates = [];
        for (let index = 0; index < parsed.length; index += 1) {
            const byte = parsed[index];
            const value = byte - 40;
            if (value < -40 || value > 220) {
                continue;
            }
            // 00 プレフィックス付き応答で後段バイトが実データになるECUを優先するため、後ろのバイトを加点。
            let score = index;
            if (byte !== 0) {
                score += 2;
            }
            if (value >= 40 && value <= 140) {
                score += 2;
            }
            if (Number.isFinite(coolantTemp)) {
                score += Math.max(0, 4 - Math.abs(value - Number(coolantTemp)) / 15);
            }
            candidates.push({ value, score });
        }
        for (let index = 0; index < parsed.length - 1; index += 1) {
            const word = (parsed[index] << 8) | parsed[index + 1];
            const formulas = [word - 40, word / 10 - 40, word / 100 - 40];
            for (const candidateValue of formulas) {
                if (candidateValue < -40 || candidateValue > 220) {
                    continue;
                }
                let score = 1;
                if (candidateValue >= 40 && candidateValue <= 140) {
                    score += 3;
                }
                if (Number.isFinite(coolantTemp)) {
                    score += Math.max(0, 4 - Math.abs(candidateValue - Number(coolantTemp)) / 15);
                }
                candidates.push({ value: Math.round(candidateValue * 10) / 10, score });
            }
        }
        if (!candidates.length) {
            return null;
        }
        candidates.sort((left, right) => right.score - left.score);
        return candidates[0]?.value ?? null;
    }
    findPatternIndex(haystack, needle) {
        if (needle.length === 0 || haystack.length < needle.length) {
            return -1;
        }
        for (let index = 0; index <= haystack.length - needle.length; index += 1) {
            const matches = needle.every((token, offset) => haystack[index + offset] === token);
            if (matches) {
                return index;
            }
        }
        return -1;
    }
    notifyConnectionLost(reason) {
        if (this.connectionLostNotified) {
            return;
        }
        this.connectionLostNotified = true;
        this.isMonitoring = false;
        this.stopTimers();
        if (this.onConnectionLostCallback) {
            this.onConnectionLostCallback(reason);
        }
    }
    /**
     * OBDLink EX に見えるポートを優先して選択する。
     * macOS の内部ポートを除外し、USBシリアルらしい候補や manufacturer 情報を加点して選ぶ。
     */
    choosePreferredPort(ports) {
        // debug-console / Bluetooth / iPhone など、車両インターフェースではないものを除外する。
        const candidates = ports.filter((port) => !this.ignoredPortPatterns.some((pattern) => pattern.test(port.path)));
        if (candidates.length === 0) {
            return null;
        }
        // 最も OBDLink EX らしいポートをスコアリングで選ぶ。
        // manufacturer に obdlink / obd / scan が入るものを強く優先し、USB系のパスも加点する。
        const scored = candidates
            .map((port) => {
            let score = 0;
            const path = port.path.toLowerCase();
            const manufacturer = port.manufacturer.toLowerCase();
            if (path.includes('usbserial'))
                score += 50;
            if (path.includes('usbmodem'))
                score += 40;
            if (path.includes('cu.'))
                score += 20;
            if (path.includes('tty.'))
                score += 10;
            if (manufacturer.includes('obdlink'))
                score += 100;
            if (manufacturer.includes('scan') || manufacturer.includes('obd'))
                score += 60;
            if (manufacturer.includes('ftdi') || manufacturer.includes('silicon labs') || manufacturer.includes('prolific'))
                score += 30;
            if (port.vendorId)
                score += 5;
            if (port.productId)
                score += 5;
            return { ...port, score };
        })
            .sort((left, right) => right.score - left.score);
        return scored[0] ?? null;
    }
}
exports.OBDService = OBDService;
//# sourceMappingURL=obd-service.js.map