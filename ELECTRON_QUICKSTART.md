# Electron 開発実行 - クイックスタート

## 1 行で開始する（最も簡単）

```bash
npm run electron:dev
```

Electron アプリが起動し、ホットリロード対応で自動的に再起動します。

---

## VS Code でデバッグ実行

### ステップ 1: デバッグ設定を開く
- VS Code メニュー：**Run → Start Debugging**
- または `Ctrl+Shift+D` キー

### ステップ 2: デバッグ構成を選択
```
▼ Electron Main Debug
```

### ステップ 3: 実行
- **再生ボタン**（▶）をクリック

### ステップ 4: デバッグ

| 操作 | 説明 |
|------|------|
| **F10** | ステップオーバー |
| **F11** | ステップイン |
| **Shift+F11** | ステップアウト |
| **Ctrl+Shift+D** | ブレークポイント パネル |
| **F5** | 続行 |
| **Shift+F5** | 停止 |

---

## ファイル変更時の自動ホットリロード

```bash
npm run electron:dev
```

実行中に以下を変更すると自動リロード：

- `src/app/**/*.ts` → Renderer ホットリロード
- `src/app/**/*.html` → Renderer ホットリロード
- `electron/main.ts` → Main プロセス再起動

---

## Electron アプリ内でのデバッグ

Electron アプリ起動後：

1. **`F12` キー**を押す
2. **Chrome DevTools** が開く
3. Angular コンポーネントのブレークポイント設定可能

---

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `npm run electron:dev` | ホットリロード開発実行 |
| `npm run electron:debug` | Node.js Inspector 対応デバッグ実行 |
| `npm run electron:build` | 本番向けビルド |
| `npm run electron` | 本番向けリリース実行 |

---

## よくあるエラーと解決方法

### ❌ `localhost:4200 に接続できない`

```bash
# 別ターミナルで Angular をビルド
npm run watch

# または完全にリセット
npm run electron:dev  # この中に watch が含まれている
```

### ❌ `electron コマンドが見つからない`

```bash
npm install
npm run electron:dev
```

### ❌ ホットリロードが動作しない

```bash
# Electron を再起動
# Ctrl+C で終了後
npm run electron:dev
```

---

## 開発時のベストプラクティス

✅ **DO:**
- `npm run electron:dev` で開始
- VS Code のブレークポイントを活用
- `F12` で Renderer DevTools を確認
- コンソール出力で動作確認

❌ **DON'T:**
- 手動でプロセスを再起動
- ネットワークを切断した状態で実行
- IPC メッセージの非同期待機を忘れる

---

## 次のステップ

1. [ELECTRON_DEV_GUIDE.md](ELECTRON_DEV_GUIDE.md) で詳細を確認
2. [OBDLINK_INTEGRATION.md](OBDLINK_INTEGRATION.md) で OBD 機能を確認
3. `src/app/app.ts` で UI を拡張
