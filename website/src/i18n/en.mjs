export default {
  code: 'en', htmlLang: 'en', name: 'English',
  meta: {
    title: 'MaterialsX | Research you can trace',
    description: 'MaterialsX is a local-first workspace for materials research. Work with papers and experiments, scientific Skills, MOOS data, and evidence-linked results.',
  },
  nav: { product: 'Capabilities', process: 'How it works', gallery: 'Inside the app', download: 'Get a build', faq: 'FAQ', menu: 'Open navigation', language: 'Choose language' },
  topbar: '0.3.0-preview.1 available · MX Points billing remains in testing',
  a11y: { skip: 'Skip to content', backToTop: 'Back to top', metrics: 'MaterialsX at a glance' },
  hero: {
    eyebrow: 'LOCAL-FIRST RESEARCH WORKSPACE',
    title: 'Turn materials questions into', highlight: 'research you can trace.',
    description: 'Start with papers, formulations, and lab records. Let an agent use the right Skills and tools while keeping each source, action, and result in one research project.',
    primary: 'Explore capabilities', secondary: 'Check release status',
    note: 'The desktop app is free, and 0.3.0-preview.1 installers are public. MX Points purchases and cloud models remain a pilot, not a general paid release.',
  },
  metrics: [
    { value: '98', label: 'bundled scientific Skills' },
    { value: '176', label: 'potential and resource listings' },
    { value: '2', label: 'selectable agent engines' },
  ],
  intro: {
    eyebrow: 'WHY MATERIALSX', title: 'Research is a chain of decisions, not a single answer.',
    description: 'MaterialsX connects objectives, input data, tool runs, and conclusions. Unverified records keep their status, and computed results carry their applicability limits.',
  },
  pillars: [
    { number: '01', title: 'Start with evidence', description: 'Keep page numbers, original values, and sources close to the claims they support.' },
    { number: '02', title: 'See the method', description: 'Review the plan, Skill, tool calls, and receipts for each step of the task.' },
    { number: '03', title: 'Check the result', description: 'Keep charts, structures, and reports in the project, alongside gaps and scientific caveats.' },
  ],
  process: {
    eyebrow: 'A RESEARCH FLOW', title: 'Four clear steps from question to deliverable.',
    description: 'Handle simple questions directly. For complex work, define goals, constraints, and acceptance criteria first.',
    steps: [
      { number: '01', title: 'Define the goal', description: 'Name the material system, question, target measures, and limits.' },
      { number: '02', title: 'Gather evidence', description: 'Choose papers, project files, or configured MOOS records.' },
      { number: '03', title: 'Run a method', description: 'Use authorized Skills, analysis tools, or eligible models.' },
      { number: '04', title: 'Review delivery', description: 'Inspect data, charts, structures, reports, and unresolved gaps.' },
    ],
  },
  features: {
    eyebrow: 'CAPABILITIES', title: 'Built for real materials research tasks.',
    description: 'Bring common workflows together while making data, runtime, and human-review requirements explicit.',
    cards: [
      { tag: 'Papers & files', title: 'Extract with source locations', description: 'Work with PDF, DOCX, spreadsheets, and text. Extracted passages retain page, paragraph, or sheet locations for review.', foot: 'PDF limit: 100 MiB / 2,000 pages' },
      { tag: 'Research workflows', title: '98 bundled Skills', description: 'Browse bilingual descriptions and examples by topic, invoke a Skill with @, or install one from a local folder or GitHub.', foot: 'Some Skills need optional scientific dependencies' },
      { tag: 'Research data', title: 'Connect MOOS records', description: 'A separate read-only MCP service can query experiments, formulations, processes, properties, images, and simulations.', foot: 'MOOS service configuration required' },
      { tag: 'Materials models', title: 'Screen before calculating', description: 'Explore 100 model and resource entries, then check domain, elements, license, weights, and runtime before choosing a route.', foot: 'A catalog entry is not an installed checkpoint' },
      { tag: 'Agent engines', title: 'Local or platform models', description: 'Choose Pi or the bundled Codex App Server. Connect LM Studio locally or a configured platform service.', foot: 'Tool-use capability depends on the model' },
      { tag: 'Structures & review', title: 'See both results and limits', description: 'Inspect atomic structures and 3D artifacts while checking units, evidence, convergence, and method applicability.', foot: 'Computation needs matching runtimes and weights' },
    ],
  },
  gallery: {
    eyebrow: 'INSIDE THE APP', title: 'Keep the research process in one workspace.',
    description: 'Screenshots come from isolated development demos. The installed version and its configuration determine the actual interface and capabilities.',
    tabs: [
      { id: 'workbench', label: 'Workspace', title: 'Projects, tasks, and sources together', description: 'Start with a local project and keep conversations and input files in the same workspace.', imageAlt: 'MaterialsX research workspace screenshot' },
      { id: 'skills', label: 'Skills library', title: 'Find the method that fits', description: 'Review categories, capabilities, licenses, and examples before bringing a Skill into a task.', imageAlt: 'MaterialsX Skills catalog and detail screenshot' },
      { id: 'atomic', label: 'Atomic 3D', title: 'Inspect the structure behind the numbers', description: 'View structures and computation artifacts where a supported runtime is available. An image is not scientific validation.', imageAlt: 'MaterialsX 3D atomic structure screenshot' },
    ],
  },
  download: {
    eyebrow: 'DOWNLOAD STATUS', title: 'Find the preview build that fits.',
    description: 'The 0.3.0-preview.1 installers for macOS Apple Silicon and Windows x64 are available on GitHub Releases. Signing, notarization, and cross-device acceptance remain open.',
    link: 'View public releases', guide: 'Read the setup guide',
    cards: [
      { platform: 'macOS', arch: 'Apple Silicon', status: '0.3.0-preview.1: available', detail: 'Locally checked; Apple notarization and clean-machine installation remain unverified.' },
      { platform: 'Windows', arch: 'x64', status: '0.3.0-preview.1: available', detail: 'Preview installer published; Windows device testing remains open.' },
      { platform: 'Linux', arch: 'x64', status: 'No public installer yet', detail: 'Check the release page for the exact version and architecture.' },
    ],
    note: 'No chat-model weights are bundled. Load a local model in LM Studio or another compatible tool. Scientific outputs require human review.',
  },
  start: {
    eyebrow: 'GET STARTED', title: 'Begin with a local project.',
    steps: [
      { title: 'Choose a project folder', description: 'Create a research task so conversations, inputs, and artifacts stay in your workspace.' },
      { title: 'Connect a model', description: 'Load a model in LM Studio and start its local API, then check the connection in MaterialsX settings.' },
      { title: 'Ask a checkable question', description: 'Choose a Skill or state a goal directly, such as extracting experimental values with page citations.' },
    ],
    exampleLabel: 'Example prompt', example: '@materials-literature-rpsme-json Extract the experimental formulations from this paper with original amounts and evidence page numbers.',
  },
  faq: {
    eyebrow: 'FAQ', title: 'A few things to know before you begin.',
    items: [
      { q: 'Is MaterialsX free to use?', a: 'The desktop app is free, and local models can run on your own computer. Eligible platform models use MX Points based on four token categories. Purchases are currently limited to the local test environment; the signed-in catalog shows actual eligibility and rates.' },
      { q: 'Are all 100 materials models installed and ready?', a: 'No. The 100 items are bilingual catalog entries for potentials, models, and related resources. Weights, dependencies, licenses, and execution eligibility must be checked individually.' },
      { q: 'Can I connect my own local model?', a: 'Yes. MaterialsX supports the local LM Studio API. Tool calling and long-task reliability depend on the model, protocol, and runtime; run a compatibility check first.' },
      { q: 'Is MOOS data available automatically?', a: 'No. The separate MOOS MCP service must be deployed and configured. Queries are read-only, and records awaiting review keep that status.' },
      { q: 'Does it replace scientific judgment?', a: 'No. MaterialsX helps organize evidence, run eligible methods, and preserve receipts. Researchers must still verify experiments, model applicability, and final scientific claims.' },
    ],
  },
  footer: { tagline: 'A local-first AI workspace for materials R&D.', product: 'Product', resources: 'Resources', release: 'Public releases', repository: 'GitHub repository', security: 'Security reports', copyright: '© 2026 Jilin University AI-DAOS Team' },
};
