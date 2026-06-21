<a id="english"></a>

# CarManager

[English](#english) | [日本語](#japanese)

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-6366f1.svg)](LICENSE)

CarManager is a desktop vehicle telemetry application for monitoring, recording, and reviewing automotive data through an OBD interface.

It provides a focused dashboard for live vehicle status while preserving drive telemetry in a local database for later analysis. The application is designed to keep vehicle data on the user's computer and present both current conditions and historical trends in one place.

## Product features

- Live monitoring of speed, engine RPM, temperatures, fuel level, engine load, throttle position, ignition timing, intake data, air flow, and control-module voltage
- OBDLink EX serial-port detection and connection management
- Vehicle identification using VIN and locally managed vehicle profiles
- One-second drive telemetry recording with local DuckDB storage
- Historical drive-log charts with shared time axes, grouped parameters, and configurable visibility
- Connection-history and disconnection-reason tracking
- Storage usage monitoring, capacity warnings, and log-reservation management
- Support for standard OBD-II and expandable vehicle-specific monitoring modes

## Data and privacy

Vehicle profiles, connection history, and drive telemetry are stored locally. CarManager does not require vehicle telemetry to be uploaded to an external service.

## License

CarManager is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE).

- Personal study, research, experimentation, and hobby use are permitted.
- Noncommercial modification and redistribution are permitted under the license terms.
- Commercial use, including use in a commercial product or service, is not permitted without a separate written license from the copyright holder.

---

<a id="japanese"></a>

# CarManager

[English](#english) | [日本語](#japanese)

[![ライセンス: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-6366f1.svg)](LICENSE)

CarManagerは、OBDインターフェースを通じて車両情報を監視・記録・確認するためのデスクトップ車両テレメトリーアプリケーションです。

リアルタイムの車両状態を見やすいダッシュボードへ表示するとともに、走行データをローカルデータベースへ保存し、後から分析できます。現在の車両状態と過去の走行傾向を一か所で確認し、車両データを利用者のコンピューター内で管理することを重視しています。

## 製品機能

- 速度、エンジン回転数、各種温度、燃料残量、エンジン負荷、スロットル開度、点火時期、吸気情報、空気流量、制御モジュール電圧のリアルタイム監視
- OBDLink EXのシリアルポート検出と接続管理
- VINおよびローカル車両プロフィールによる車両識別
- 1秒単位の走行テレメトリー記録とDuckDBによるローカル保存
- 共通時間軸、パラメーターグループ、表示切替に対応した走行履歴グラフ
- 接続履歴および切断理由の記録
- ストレージ使用状況、容量警告、ログ予約容量の管理
- 標準OBD-IIおよび拡張可能な車種別監視モードへの対応

## データとプライバシー

車両プロフィール、接続履歴、走行テレメトリーはローカル環境へ保存されます。CarManagerは、車両テレメトリーを外部サービスへアップロードすることを必須としません。

## ライセンス

CarManagerは [PolyForm Noncommercial License 1.0.0](LICENSE) に基づくsource-availableソフトウェアです。

- 個人の学習、研究、実験、趣味での利用が許可されます。
- ライセンス条件に従う場合、非商用目的の変更と再配布が許可されます。
- 商用製品や商用サービスでの利用には、著作権者から別途書面による許諾を得る必要があります。

法的効力を持つ正式な条件は、英語の [LICENSE](LICENSE) を参照してください。上記は理解を助けるための日本語要約です。
