# CarManager

[English](README.md) | [日本語](README.ja.md)

[![ライセンス: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-6366f1.svg)](LICENSE)

> 非商用目的でソースを利用できます。商用利用には、別途書面によるライセンス契約が必要です。

このプロジェクトは [Angular CLI](https://github.com/angular/angular-cli) バージョン22.0.3を使用して生成されています。

## 開発サーバー

ローカル開発サーバーを起動するには、次のコマンドを実行します。

```bash
ng serve
```

起動後、ブラウザで `http://localhost:4200/` を開いてください。ソースファイルを変更すると、アプリケーションが自動的にリロードされます。

Electronの開発環境では、VS Codeの「実行とデバッグ」から `Electron Dev (Auto-reload)` を選択して起動できます。

## コード生成

Angular CLIのコード生成機能を使用して、新しいコンポーネントを生成できます。

```bash
ng generate component component-name
```

利用可能な生成機能の一覧は、次のコマンドで確認できます。

```bash
ng generate --help
```

## ビルド

プロジェクトをビルドするには、次のコマンドを実行します。

```bash
ng build
```

生成物は `dist/` ディレクトリへ出力されます。製品ビルドでは、パフォーマンスと実行速度のために最適化されます。

Electron向けにビルドする場合は、次のコマンドを使用します。

```bash
npm run electron:build
```

## ユニットテスト

[Vitest](https://vitest.dev/) でユニットテストを実行します。

```bash
ng test
```

## E2Eテスト

E2Eテストを実行するには、次のコマンドを使用します。

```bash
ng e2e
```

Angular CLIにはE2Eテストフレームワークが標準搭載されていないため、用途に合ったフレームワークを別途選択してください。

## ライセンス

このプロジェクトは [PolyForm Noncommercial License 1.0.0](LICENSE) に基づくsource-availableソフトウェアです。

- 個人の学習、研究、実験、趣味での利用が許可されます。
- ライセンス条件に従う場合、非商用目的の変更と再配布が許可されます。
- 商用製品や商用サービスでの利用には、著作権者から別途書面による許諾を得る必要があります。

法的効力を持つ正式な条件は、英語の [LICENSE](LICENSE) を参照してください。本節は理解を助けるための日本語要約であり、正式なライセンス本文ではありません。

## 関連資料

Angular CLIの詳細は、[Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) を参照してください。
