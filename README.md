# DRIFT

> 会話・物語・業務フローの状況遷移を制御するシーンオーケストレーター

## 概要

シーン、目的、前提条件、分岐、状態、外部ポリシー参照をグラフとして管理し、LLMに渡す最小コンテキストを構成するOSS。

## このパッケージの位置付け

`drift` を単独OSSリポジトリとして着手するための**要求定義・設計・検証・実装バックログ**一式です。
商用利用・セルフホスト・クラウド提供を阻害しないことを前提に、ライセンスはApache-2.0を採用します。

## 想定利用者

ロールプレイAI、ゲーム、研修シミュレーション、カスタマーサービス、自動化ワークフローの開発者。

## 解決する範囲

- `Scenario and Session State Orchestrator`
- マルチテナント、監査、Plugin拡張、外部LLM／ローカルLLMとの疎結合を前提にする
- AI恋愛・コンパニオン用途に限らず、ゲーム、教育、顧客接点、業務AIへ転用可能とする

## 非対象

- 物語や会話本文そのものを生成しない。
- LLM Providerを直接固定しない。
- 無制限の自由遷移を既定にしない。

## ドキュメント索引

| ファイル | 内容 |
|---|---|
| `AGENTS.md` | 実装担当AI・人間開発者向けの不変ルール |
| `docs/00_GLOSSARY.md` | 用語・境界定義 |
| `docs/01_BMA.md` | 事業・ミッション分析（15288） |
| `docs/02_StRS.md` | ステークホルダー要求（29148） |
| `docs/03_SyRS.md` | システム要求（29148 / 25010） |
| `docs/04_AD.md` | アーキテクチャ記述（42010） |
| `docs/05_DD.md` | 設計記述（12207） |
| `docs/06_API_CONTRACT.md` | HTTP API・イベント・Plugin契約 |
| `docs/07_VV_PLAN.md` | 検証・妥当性確認計画 |
| `docs/08_TRACEABILITY.md` | 要求→設計→テストのトレース |
| `docs/09_MVP_BACKLOG.md` | GitHub Issue化可能なMVPバックログ |
| `docs/10_RELEASE_CRITERIA.md` | v0.1.0公開判定基準 |

## 推奨初期技術基盤

- TypeScript（strict） / Node.js LTS / pnpm
- Fastify または同等の高速HTTPフレームワーク
- PostgreSQL（`drift`の主要状態を永続化）
- OpenAPI 3.1、JSON Schema、Docker Compose
- Vitest、Testcontainers、ESLint、Prettier、GitHub Actions
- 監査・運用メトリクスはOpenTelemetry互換のtrace IDを前提とする

## 初期リポジトリ構造

```text
drift/
├── apps/api/             # HTTP API
├── packages/core/        # ドメイン・ユースケース
├── packages/contracts/   # JSON Schema / OpenAPI / DTO
├── packages/plugins/     # Plugin SPIと標準実装
├── packages/sdk-ts/      # TypeScript SDK
├── tests/                # unit / integration / contract / e2e
├── docs/                 # 本パッケージのドキュメント
├── AGENTS.md
└── docker-compose.yml
```

## リリース名

- Repository: `drift`
- Display name: `DRIFT`
- 初期目標: `v0.1.0`（MVP、API互換性は試験段階）
