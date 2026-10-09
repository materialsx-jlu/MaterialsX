export default {
  code: 'zh-TW', htmlLang: 'zh-Hant', name: '繁體中文',
  meta: {
    title: 'MaterialsX｜讓材料研究有據可查',
    description: 'MaterialsX 是面向材料研究的本機優先工作臺。整理論文與實驗資料、使用科研 Skills、連接 MOOS，交付可追溯的研究結果。',
  },
  nav: { product: '產品能力', process: '工作方式', gallery: '介面預覽', download: '取得版本', faq: '常見問題', menu: '開啟導覽', language: '選擇語言' },
  topbar: '0.3.0 已開放下載 · MX 點與模型計費仍在試點',
  a11y: { skip: '跳至內容', backToTop: '返回頂部', metrics: 'MaterialsX 產品概況' },
  hero: {
    eyebrow: 'LOCAL-FIRST RESEARCH WORKSPACE',
    title: '讓材料問題，走向', highlight: '可核對的研究結果。',
    description: '從論文、配方與實驗紀錄出發，讓 Agent 使用合適的 Skills 與工具，把過程、來源和產物留在同一個研究專案中。',
    primary: '了解產品能力', secondary: '查看版本狀態',
    note: '桌面應用程式免費使用；0.3.0 安裝檔已公開並連接正式平臺。MX 點儲值與雲端模型服務目前限試點帳戶。',
  },
  metrics: [
    { value: '98', label: '內建科研 Skills' },
    { value: '176', label: '勢與相關資源目錄項目' },
    { value: '2', label: '可選 Agent 引擎' },
  ],
  intro: {
    eyebrow: 'WHY MATERIALSX', title: '研究不是一次回答，而是一條可追溯的工作鏈。',
    description: 'MaterialsX 讓任務目標、輸入資料、工具執行和最終結論保持關聯。未驗證資料保留原有狀態，模型計算也標明適用範圍。',
  },
  pillars: [
    { number: '01', title: '證據先行', description: '閱讀論文與資料時保留頁碼、原始數值和來源，方便回到依據。' },
    { number: '02', title: '方法可見', description: '計畫、Skill、工具呼叫與執行回執集中記錄，知道每一步做了什麼。' },
    { number: '03', title: '結果可複核', description: '圖表、結構與報告保存在專案中；缺項和科學限制不會被隱藏。' },
  ],
  process: {
    eyebrow: 'A RESEARCH FLOW', title: '從問題到交付，四步走得明白。',
    description: '簡單問題直接處理；複雜任務先明確目標、限制與驗收，再逐步執行。',
    steps: [
      { number: '01', title: '說明目標', description: '寫下材料體系、想解決的問題、指標和限制。' },
      { number: '02', title: '蒐集依據', description: '選擇論文、專案檔案或已設定的 MOOS 資料。' },
      { number: '03', title: '執行方法', description: '依授權呼叫 Skills、分析工具或適用模型。' },
      { number: '04', title: '檢查交付', description: '查看資料、圖表、結構、報告與未解決的問題。' },
    ],
  },
  features: {
    eyebrow: 'CAPABILITIES', title: '為真實的材料研究任務準備。',
    description: '將常用入口放在一起，也說明哪些能力需要額外資料、執行環境或人工複核。',
    cards: [
      { tag: '文獻與檔案', title: '保留頁碼的資料擷取', description: '支援 PDF、DOCX、試算表與文字附件。擷取內容保留頁碼、段落或工作表位置，方便核對原文。', foot: 'PDF 上限 100 MiB／2000 頁' },
      { tag: '科研流程', title: '98 項內建 Skills', description: '依主題瀏覽雙語介紹和使用範例，在對話中用 @ 引用；也可安裝本機或 GitHub Skill。', foot: '部分 Skill 仍需另行設定科學依賴' },
      { tag: '研究資料', title: '連接 MOOS 資料', description: '透過獨立的唯讀 MCP 查詢實驗、配方、製程、性能、影像與模擬紀錄，並保留複核狀態。', foot: '需先設定 MOOS 服務' },
      { tag: '材料模型', title: '先篩選，再計算', description: '瀏覽 100 項模型與相關資源，檢查材料領域、元素、授權、權重和執行環境，再選擇適用路線。', foot: '目錄收錄不代表權重已安裝' },
      { tag: 'Agent 引擎', title: '本機或平臺模型', description: '可選 Pi 或隨應用打包的 Codex App Server；支援 LM Studio 本機介面與已設定的平臺服務。', foot: '模型的工具能力仍需實測' },
      { tag: '結構與驗收', title: '看見計算，也看見界線', description: '查看原子結構與 3D 結果，核對單位、證據、收斂與方法適用範圍，保留科學複核結論。', foot: '計算依賴相符的執行環境和權重' },
    ],
  },
  gallery: {
    eyebrow: 'INSIDE THE APP', title: '把研究過程放在同一個工作臺。',
    description: '以下為隔離示範環境中的開發版截圖；實際介面與可用能力以安裝版本和設定為準。',
    tabs: [
      { id: 'workbench', label: '研究工作臺', title: '專案、任務和來源連在一起', description: '從本機專案開始，研究對話與輸入檔案留在同一個工作空間。', imageAlt: 'MaterialsX 研究工作臺截圖' },
      { id: 'skills', label: 'Skills 目錄', title: '依方法找到合適的 Skill', description: '瀏覽分類、能力、授權與使用範例，再把任務帶回對話。', imageAlt: 'MaterialsX Skills 分類與詳情截圖' },
      { id: 'atomic', label: '原子結構 3D', title: '從數值走向可檢查的結構', description: '在支援的環境中查看原子結構與計算產物；影像不能取代科學驗證。', imageAlt: 'MaterialsX 原子結構三維介面截圖' },
    ],
  },
  download: {
    eyebrow: 'DOWNLOAD STATUS', title: '選擇適合你的安裝檔。',
    description: '0.3.0 的 macOS Apple Silicon 與 Windows x64 安裝檔連接正式平臺，已發佈至 GitHub Releases。簽署、公證及跨裝置驗收仍在進行。',
    link: '查看 0.3.0 發行說明', guide: '查看使用指南',
    cards: [
      { platform: 'macOS', arch: 'Apple Silicon', status: '0.3.0：可下載', detail: '已完成本機校驗；Apple 公證及全新裝置安裝驗收尚未完成。', asset: 'macos', action: '下載 DMG' },
      { platform: 'Windows', arch: 'x64', status: '0.3.0：可下載', detail: '安裝檔已發佈；Windows 實機驗收尚未完成。', asset: 'windows', action: '下載 EXE' },
      { platform: 'Linux', arch: 'x64', status: '目前無公開安裝檔', detail: '請以發行頁明確標示的版本與架構為準。', asset: 'linux', action: '下載 AppImage' },
    ],
    verify: '下載後可對照 SHA-256 清單驗證檔案：', checksums: '查看 SHA256SUMS.txt',
    note: '軟體不包含聊天模型權重；本機模型需自行在 LM Studio 等工具中載入。科研輸出需人工複核。',
  },
  start: {
    eyebrow: 'GET STARTED', title: '從一個本機專案開始。',
    steps: [
      { title: '選擇專案資料夾', description: '建立研究任務，讓對話、輸入和產物留在你的工作空間。' },
      { title: '連接模型', description: '在 LM Studio 載入模型並啟動本機 API，再到 MaterialsX 設定中檢測介面。' },
      { title: '提出可核對的問題', description: '選擇 Skill 或直接描述目標，例如擷取論文的實驗資料並附上頁碼。' },
    ],
    exampleLabel: '提問範例', example: '@materials-literature-rpsme-json 擷取這篇論文的實驗配方，列出原始用量與證據頁碼。',
  },
  faq: {
    eyebrow: 'FAQ', title: '開始之前，先了解這些。',
    items: [
      { q: 'MaterialsX 軟體本身收費嗎？', a: '桌面軟體免費使用，本機模型可在你的電腦執行。已准入的平台模型按四類 Token 用量扣 MX 點；目前僅限本機測試環境購買，實際模型和價格以登入後目錄為準。' },
      { q: '100 項材料模型都已安裝並能執行嗎？', a: '不是。100 項是雙語目錄條目，包含勢、模型及相關資源。權重、依賴、授權和實際執行資格須逐項確認。' },
      { q: '可以連接自己的本機模型嗎？', a: '可以。MaterialsX 支援 LM Studio 的本機 API。工具呼叫與長任務表現取決於模型、介面能力及執行環境，建議先做相容性檢測。' },
      { q: 'MOOS 資料會自動可用嗎？', a: '不會。需先部署並設定獨立的 MOOS MCP 服務。查詢為唯讀，待複核紀錄會保留原有狀態。' },
      { q: '它能取代材料專家作結論嗎？', a: '不能。MaterialsX 協助整理證據、執行適用方法並留下回執；實驗真實性、模型適用性與最終科學結論仍需研究者複核。' },
    ],
  },
  footer: { tagline: '面向材料研發的本機優先 AI 工作臺。', product: '產品', resources: '資源', release: '公開版本', repository: 'GitHub 儲存庫', security: '安全問題', copyright: '© 2026 吉林大學 AI-DAOS 團隊' },
};
