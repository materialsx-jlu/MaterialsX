export default {
  code: 'ja', htmlLang: 'ja', name: '日本語',
  meta: {
    title: 'MaterialsX｜根拠をたどれる材料研究へ',
    description: 'MaterialsX は材料研究向けのローカル優先ワークスペースです。論文、実験記録、科学 Skill、MOOS データを結び、根拠を確認できる成果を残します。',
  },
  nav: { product: '主な機能', process: '研究の流れ', gallery: '画面を見る', download: '配布状況', faq: 'よくある質問', menu: 'メニューを開く', language: '言語を選択' },
  topbar: '0.3.0 公開中 · MX ポイント課金は試験運用中',
  a11y: { skip: '本文へ移動', backToTop: 'ページ先頭へ', metrics: 'MaterialsX の概要' },
  hero: {
    eyebrow: 'LOCAL-FIRST RESEARCH WORKSPACE',
    title: '材料の問いを、', highlight: '根拠をたどれる研究成果へ。',
    description: '論文、配合、実験記録から始め、Agent が適切な Skills とツールを使います。出典、実行過程、成果物を一つの研究プロジェクトに残せます。',
    primary: '機能を見る', secondary: '配布状況を見る',
    note: 'デスクトップアプリは無料です。0.3.0 のインストーラーは正式なプラットフォームに接続します。MX ポイント購入とクラウドモデルは試験アカウントに限定しています。',
  },
  metrics: [
    { value: '98', label: '同梱の科学 Skills' },
    { value: '176', label: 'ポテンシャル・関連資源の項目' },
    { value: '2', label: '選択できる Agent エンジン' },
  ],
  intro: {
    eyebrow: 'WHY MATERIALSX', title: '研究は一度の回答ではなく、検証できる過程です。',
    description: 'MaterialsX は研究目標、入力資料、ツールの実行、結論を結びます。未検証の記録はその状態を保ち、計算結果には適用範囲を示します。',
  },
  pillars: [
    { number: '01', title: '根拠から始める', description: '論文のページ、元の数値、出典を残し、主張の根拠に戻れます。' },
    { number: '02', title: '方法を見える化', description: '計画、Skill、ツール呼び出し、実行結果を各段階で確認できます。' },
    { number: '03', title: '成果を再確認', description: '図表、構造、報告をプロジェクトに保存し、欠損や科学的な制約も示します。' },
  ],
  process: {
    eyebrow: 'A RESEARCH FLOW', title: '問いから成果まで、明確な四つの段階。',
    description: '簡単な質問は直接処理し、複雑な研究では目標・制約・完了基準を先に定めます。',
    steps: [
      { number: '01', title: '目標を定める', description: '材料系、課題、評価指標、制約を記述します。' },
      { number: '02', title: '根拠を集める', description: '論文、プロジェクト内の資料、設定済みの MOOS 記録を選びます。' },
      { number: '03', title: '方法を実行', description: '許可された Skills、分析ツール、適格なモデルを使います。' },
      { number: '04', title: '成果を確認', description: 'データ、図表、構造、報告、未解決の点を確認します。' },
    ],
  },
  features: {
    eyebrow: 'CAPABILITIES', title: '実際の材料研究のための機能。',
    description: 'よく使う作業をまとめ、追加データや実行環境、人による確認が必要な箇所を明示します。',
    cards: [
      { tag: '論文とファイル', title: '場所を残す資料抽出', description: 'PDF、DOCX、表計算、テキストに対応。抽出内容にはページ、段落、シートの位置を残します。', foot: 'PDF の上限：100 MiB／2,000 ページ' },
      { tag: '研究ワークフロー', title: '98 の同梱 Skills', description: '分野別の説明と使用例を見て、会話で @ を使って指定できます。ローカルや GitHub から追加も可能です。', foot: '一部の Skill は追加の科学依存環境が必要' },
      { tag: '研究データ', title: 'MOOS 記録と接続', description: '独立した読み取り専用 MCP で実験、配合、工程、物性、画像、シミュレーション記録を検索します。', foot: 'MOOS サービスの設定が必要' },
      { tag: '材料モデル', title: '計算前に適合性を確認', description: '100 件のモデル・関連資源を閲覧し、材料領域、元素、ライセンス、重み、実行環境を確認します。', foot: '目録への掲載は重みのインストールを意味しません' },
      { tag: 'Agent エンジン', title: 'ローカルまたは外部モデル', description: 'Pi と同梱の Codex App Server から選択。LM Studio のローカル API や設定済みのプラットフォームにも接続できます。', foot: 'ツール利用能力はモデルごとの検証が必要' },
      { tag: '構造と検証', title: '結果と限界を一緒に示す', description: '原子構造と 3D 成果物を見ながら、単位、根拠、収束、方法の適用範囲を確認します。', foot: '計算には適合する環境と重みが必要' },
    ],
  },
  gallery: {
    eyebrow: 'INSIDE THE APP', title: '研究の過程を一つのワークスペースに。',
    description: '画像は隔離されたデモ環境の開発版です。実際の画面と機能は、インストールした版と設定により異なります。',
    tabs: [
      { id: 'workbench', label: '研究画面', title: 'プロジェクト、タスク、出典を一緒に', description: 'ローカルプロジェクトで会話と入力ファイルをまとめて管理します。', imageAlt: 'MaterialsX 研究ワークスペースの画像' },
      { id: 'skills', label: 'Skills 目録', title: '作業に合った Skill を探す', description: '分類、機能、ライセンス、使用例を確認してからタスクに取り込みます。', imageAlt: 'MaterialsX Skills 目録と詳細の画像' },
      { id: 'atomic', label: '原子構造 3D', title: '数値の背後にある構造を見る', description: '対応環境で構造と計算成果物を表示します。画像だけで科学的妥当性は証明できません。', imageAlt: 'MaterialsX 原子構造 3D 画面の画像' },
    ],
  },
  download: {
    eyebrow: 'DOWNLOAD STATUS', title: 'インストーラーを選択。',
    description: '0.3.0 のインストーラーを公開停止しました。容量を削減し、macOS のダウンロード後の検証問題を修正しています。署名、公証、インストール確認後に新しい版を公開します。',
    link: '公開状況を見る', guide: '導入ガイドを見る',
    cards: [
      { platform: 'macOS', arch: 'Apple Silicon', status: '一時停止中', detail: 'Developer ID 署名、Apple 公証、ダウンロード後のインストール検証を待っています。', asset: 'macos', action: 'DMG をダウンロード' },
      { platform: 'Windows', arch: 'x64', status: '一時停止中', detail: '0.3.0 とともに撤回しました。新しい版は実機で検証後に公開します。', asset: 'windows', action: 'EXE をダウンロード' },
      { platform: 'Linux', arch: 'x64', status: '公開中のインストーラーなし', detail: '公開ページで版とアーキテクチャを確認してください。', asset: 'linux', action: 'AppImage をダウンロード' },
    ],
    verify: 'ダウンロード後、SHA-256 一覧と照合できます：', checksums: 'SHA256SUMS.txt を見る',
    withdrawn: '現在、公開基準を満たしたインストーラーはありません。古いリンクからダウンロードしないでください。',
    note: '会話モデルの重みは同梱されません。ローカルモデルは LM Studio などで別途読み込んでください。科学的な成果には人による確認が必要です。',
  },
  start: {
    eyebrow: 'GET STARTED', title: 'ローカルプロジェクトから始めましょう。',
    steps: [
      { title: 'プロジェクトフォルダーを選ぶ', description: '研究タスクを作り、会話、入力、成果物を同じ作業領域に保存します。' },
      { title: 'モデルを接続する', description: 'LM Studio でモデルとローカル API を起動し、MaterialsX の設定で接続を確認します。' },
      { title: '検証できる問いを立てる', description: 'Skill を選ぶか、論文中の実験値をページ付きで抽出するなどの目標を記述します。' },
    ],
    exampleLabel: '質問の例', example: '@materials-literature-rpsme-json この論文の実験配合を抽出し、元の量と根拠のページ番号を示してください。',
  },
  faq: {
    eyebrow: 'FAQ', title: '利用前に知っておきたいこと。',
    items: [
      { q: 'MaterialsX のアプリは無料ですか？', a: 'デスクトップアプリは無料で、ローカルモデルは手元の計算機で実行できます。利用資格のあるプラットフォームモデルは四種類の Token 使用量に応じて MX ポイントを消費します。購入は現在ローカルのテスト環境に限り、利用可能なモデルと価格はログイン後の一覧で確認できます。' },
      { q: '100 件の材料モデルはすべて使用可能ですか？', a: 'いいえ。100 件はポテンシャル、モデル、関連資源の目録です。重み、依存関係、ライセンス、実行資格をそれぞれ確認する必要があります。' },
      { q: '自分のローカルモデルに接続できますか？', a: 'はい。LM Studio のローカル API に対応します。ツール呼び出しや長時間タスクの安定性はモデルと環境に依存するため、先に互換性を確認してください。' },
      { q: 'MOOS のデータは自動的に使えますか？', a: 'いいえ。独立した MOOS MCP サービスを導入・設定する必要があります。検索は読み取り専用で、未確認記録はその状態を保ちます。' },
      { q: '材料研究者の判断を置き換えられますか？', a: 'いいえ。証拠の整理と適切な方法の実行を支援しますが、実験の真偽、モデルの適合性、最終的な科学的主張は研究者による確認が必要です。' },
    ],
  },
  footer: { tagline: '材料研究開発のためのローカル優先 AI ワークスペース。', product: '製品', resources: 'リソース', release: '公開版', repository: 'GitHub リポジトリ', security: '脆弱性の報告', copyright: '© 2026 吉林大学 AI-DAOS チーム' },
};
