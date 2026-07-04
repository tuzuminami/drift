# 07. 検証・妥当性確認計画

    ## 1. V&V方針
    - **Verification**: 要求どおりに実装されているか。unit、integration、contract、security、migration testで検証する。
    - **Validation**: 実利用シナリオで意図した価値を提供するか。MVP acceptance flowと利用者レビューで確認する。

    ## 2. テスト階層
    | 層 | 目的 | 実行タイミング |
    |---|---|---|
    | Unit | ドメイン不変条件と状態遷移 | PRごと |
    | Integration | DB、transaction、outbox、migration | PRごと |
    | Contract | OpenAPI、SDK、Plugin SPI | PRごと |
    | Security | tenant越境、認可、Secret非露出、fail-closed | PRごと + release |
    | E2E | Docker Compose上の主要利用シナリオ | main + release |
    | Performance | p95、同時更新、外部障害時の縮退 | release候補 |

    ## 3. 必須テスト観点
    - グラフ妥当性
- Guard拒否
- 再生決定性
- Action失敗時の補償
- Version固定

    ## 4. 受入テスト
    **AT-DRIFT-001**

    公開済みScenario Version 1で開始したSessionはVersion 2公開後もVersion 1の遷移規則を使用し、EventログからReplayした最終Sceneとslot値が一致する。

    ## 5. 品質ゲート
    - lint / typecheck / test / OpenAPI lintがすべて成功。
    - 主要機能要求にテストIDが紐づく。
    - tenant越境、fail-open、Secret露出の回帰テストは必須。
    - migrationは新規DBと前Version DBの両方で検証。
    - 依存ライセンスと脆弱性のスキャンをrelease前に実行。
