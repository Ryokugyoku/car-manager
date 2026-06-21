# Electron Development Guide

このドキュメントでは、Electron ネイティブアプリとして Car Manager を開発・デバッグするための方法を説明します。

## 開発環境セットアップ

### 前提条件
- Node.js 18+
- VS Code
- TypeScript

### インストール済みツール
- `electron` - ネイティブアプリフレームワーク
- `electron-reload` - ホットリロード機能
- `concurrently` - 複数プロセスの並列実行
- `wait-on` - ポートの待機

## 開発スクリプト

### 1. 基本的な開発実行（ホットリロード付き）

```bash
npm run electron:dev
```

**実行内容：**
- Angular アプリのウォッチビルド開始
- localhost:4200 でのサーバー起動待機
- Electron Main プロセスのコンパイル
- Electron アプリ起動
- ファイル変更時に自動ホットリロード

### 2. デバッグ付き開発実行（Inspector 接続対応）

```bash
npm run electron:debug
```

**実行内容：**
- ホットリロード開発と同じ
- プロセス検査ポート `5858` で接続可能
- DevTools や VS Code Inspector で接続可能

### 3. 本番用ビルド

```bash
npm run electron:build
```

**実行内容：**
- Angular 本番ビルド
- Electron Main プロセスコンパイル
- パッケージング準備完了

## VS Code デバッグ設定

### Electron Main Process デバッグ（標準）

1. **実行コマンド：** `Ctrl+Shift+D` → "Electron Main Debug" を選択
2. **機能：**
   - Electron Main プロセスのブレークポイント設定可能
   - Watch 式・コールスタック確認可能
   - 自動コンパイル（preLaunchTask）

### Electron Renderer (Angular) デバッグ

1. VS Code の **Run and Debug** → "Electron Dev (Auto-reload)" を選択
2. または Electron アプリ内で `F12` キーで DevTools 開く

### Node.js Inspector 接続

`npm run electron:debug` 実行後、別のターミナルで：

```bash
node --inspect-brk node_modules/.bin/electron .
```

VS Code の "Electron Main Attach" で `port 5858` に接続

## ホットリロードの動作

### ファイル監視対象

```typescript
// electron/main.ts での監視設定
watched: [
  path.join(__dirname, '*.js'),                          // Electron main .js
  path.join(__dirname, '../dist/car-manager/browser'),   // Angular 出力
],
```

### リロード例

| ファイル変更 | リロード動作 |
|-----------|-----------|
| `src/app/speed-meter.html` | Renderer ホットリロード |
| `src/app/speed-meter.css` | Renderer ホットリロード |
| `electron/main.ts` | Main プロセス再起動 |
| `src/services/obd.service.ts` | Renderer ホットリロード |

## トラブルシューティング

### 1. ホットリロードが動作しない

```bash
# electron-reload をリセット
rm -rf node_modules/@electron-reload
npm install electron-reload --save-dev
```

### 2. localhost:4200 接続タイムアウト

```bash
# Angular ビルドが開始されているか確認
npm run watch
# 別ターミナルで確認
curl http://localhost:4200
```

### 3. Main プロセスエラー

```bash
# TypeScript コンパイルエラー確認
tsc electron/*.ts --project electron/tsconfig.json
```

### 4. IPC 通信失敗

```typescript
// electron/main.ts でログ出力
console.log('IPC handlers registered:', ipcMain._events.keys());
```

## デバッグテクニック

### 1. Renderer (Angular) デバッグ

Electron アプリ起動後、`F12` キーで Chrome DevTools を開く

```typescript
// Angular コンポーネント内
constructor(private obdService: OBDService) {
  console.log('OBDService initialized:', this.obdService);
}
```

### 2. Main Process ブレークポイント

VS Code で `electron/main.ts` の行番号をクリック

```typescript
ipcMain.handle('obd:connect', async () => {  // ← ここにブレークポイント設定可能
  try {
    await obdService.connect();  // ← ステップ実行可能
```

### 3. IPC メッセージログ

```typescript
// Main Process (electron/main.ts)
ipcMain.handle('obd:connect', async () => {
  console.log('[IPC] obd:connect called'); // ← Main プロセスコンソール出力
  // ...
});

// Renderer (Angular)
const result = await window.obdApi.connect();
console.log('[Renderer] Connected:', result); // ← DevTools コンソール出力
```

## 本番パッケージング

```bash
# Electron Builder のインストール（オプション）
npm install electron-builder --save-dev

# アプリパッケージング
npm run electron:build
```

## ファイル構成

```
car-manager/
├── .vscode/
│   ├── launch.json          # Electron デバッグ設定
│   └── tasks.json           # Electron コンパイルタスク
├── electron/
│   ├── main.ts              # Electron Main Process（デバッグ可能）
│   ├── obd-service.ts       # OBD 通信サービス
│   ├── preload.ts           # IPC セキュア通信
│   └── tsconfig.json        # Electron 用 TypeScript 設定
├── src/
│   ├── app/
│   │   ├── app.ts           # Angular Root Component
│   │   └── speed-meter/     # Tachometer コンポーネント
│   └── services/
│       └── obd.service.ts   # Angular OBD サービス
└── package.json             # npm スクリプト（electron:dev など）
```

## 開発フロー（推奨）

### Step 1: 開発環境開始

```bash
npm run electron:dev
```

### Step 2: VS Code でデバッグ接続

1. `Ctrl+Shift+D` キー
2. "Electron Main Debug" を選択
3. 再生（▶）ボタンをクリック

### Step 3: コードを編集

```typescript
// electron/main.ts を編集
ipcMain.handle('obd:connect', async () => {
  console.log('Connecting...');  // ← 新しいログを追加
  // ...
});
```

### Step 4: ホットリロード確認

- Main Process 修正 → Electron 自動再起動
- Angular ファイル修正 → Renderer ホットリロード

## パフォーマンス最適化

### メモリリーク防止

```typescript
// electron/main.ts でのリソース管理
app.on('before-quit', async () => {
  if (obdService) {
    await obdService.disconnect();  // OBD クリーンアップ
  }
  mainWindow = null;  // メモリ解放
});
```

### Main Process ブロッキング防止

```typescript
// 時間のかかる処理は別スレッド（Worker）で実行
const { Worker } = require('worker_threads');
const worker = new Worker('./heavy-task.js');
```

## 参考資料

- [Electron 公式ドキュメント](https://www.electronjs.org/docs)
- [electron-reload](https://github.com/yan12125/electron-reload)
- [VS Code Node Debugger](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
