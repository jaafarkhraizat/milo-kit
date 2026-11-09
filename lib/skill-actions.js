// Milo Kit: actions for the Skills section in the sessions sidebar (lib/skills.js reads this).
// Each skill name maps to [label, what it does, text put in the message box]. Text that ends in a space
// waits for you to finish the sentence. Skills not listed here get actions from their argument-hint, or one "Use".
// Plugin skills are keyed by their own name (no "plugin:" prefix).

module.exports = {
  // ── Built into Claude Code ──
  'code-review': [
    ['Review my changes', 'Checks the current diff for bugs', '/code-review'],
    ['Deep review', 'More findings, some less certain', '/code-review high'],
    ['Review and fix', 'Reviews, then applies the fixes', '/code-review --fix'],
    ['Review a PR', 'Reviews a pull request by number', '/code-review PR #'],
  ],
  simplify: [
    ['Simplify changes', 'Cleans up the changed code, no bug hunt', '/simplify'],
  ],
  'security-review': [
    ['Security review', 'Checks pending changes for security issues', '/security-review'],
  ],
  init: [
    ['Write CLAUDE.md', 'Documents this codebase for Claude', '/init'],
  ],
  loop: [
    ['Run every N minutes', 'Repeats a prompt on a fixed interval', '/loop 10m '],
    ['Self-paced loop', 'Claude picks when to check back', '/loop '],
  ],
  schedule: [
    ['Schedule a routine', 'Runs a cloud agent on a cron schedule', '/schedule '],
    ['Run once later', 'One scheduled run at a set time', '/schedule run once at '],
    ['List routines', 'Shows your scheduled agents', '/schedule list'],
  ],
  'fewer-permission-prompts': [
    ['Allow safe commands', 'Adds common read-only commands to the allowlist', '/fewer-permission-prompts'],
  ],
  'update-config': [
    ['Change a setting', 'Edits settings.json: hooks, permissions, env', '/update-config '],
    ['Add a hook', 'Runs something automatically on an event', '/update-config add a hook that '],
  ],

  // ── Writing ──
  'hemingway-writer': [
    ['Write copy', 'Clear, concrete copy with no AI tells', '/hemingway-writer write '],
    ['Rewrite this', 'Tightens text you paste after it', '/hemingway-writer rewrite this: '],
    ['Microcopy', 'Buttons, empty states, errors, tooltips', '/hemingway-writer microcopy for '],
  ],
  humanizer: [
    ['Humanize text', 'Removes signs of AI writing', '/humanizer '],
  ],
  'stop-slop': [
    ['Remove AI patterns', 'Strips filler, hedging and stock phrases', '/stop-slop '],
    ['Score a draft', 'Rates how AI-like a text reads', '/stop-slop score this: '],
  ],
  copywriting: [
    ['Landing page copy', 'Headline, sections and CTAs for a page', '/copywriting landing page for '],
    ['Improve copy', 'Rewrites existing marketing copy', '/copywriting improve this: '],
    ['Headlines and CTAs', 'Options for a headline or button', '/copywriting headline options for '],
  ],
  'email-composer': [
    ['Draft an email', 'Writes a professional email', '/email-composer draft an email to '],
    ['Reply to an email', 'Answers an email you paste', '/email-composer reply to: '],
  ],
  'content-research-writer': [
    ['Research and write', 'Long-form piece with citations', '/content-research-writer write about '],
    ['Outline first', 'Builds an outline before drafting', '/content-research-writer outline for '],
    ['Improve a hook', 'Sharpens an opening paragraph', '/content-research-writer improve this hook: '],
  ],

  // ── Design ──
  'design-review': [
    ['Review a screen', 'UX/UI critique of a screenshot or layout', '/design-review '],
    ['Check hierarchy', 'Is the visual hierarchy working', '/design-review check the hierarchy of '],
    ['Accessibility check', 'Contrast, targets, focus, labels', '/design-review accessibility check for '],
  ],
  impeccable: [
    ['Critique', 'UX review of an interface', '/impeccable critique '],
    ['Polish', 'Final pass on spacing, type and detail', '/impeccable polish '],
    ['Audit', 'Accessibility, performance, edge cases', '/impeccable audit '],
    ['Animate', 'Adds purposeful motion', '/impeccable animate '],
  ],
  'frontend-design': [
    ['Build a page', 'Production-grade page with a clear style', '/frontend-design build '],
    ['Build a component', 'One polished UI component', '/frontend-design component: '],
  ],
  'ui-ux-pro-max': [
    ['Plan a UI', 'Style, palette and fonts for a product', '/ui-ux-pro-max plan '],
    ['Build a UI', 'Builds with a chosen style and stack', '/ui-ux-pro-max build '],
    ['Review a UI', 'Checks UI code against design rules', '/ui-ux-pro-max review '],
  ],
  'ui-design-system': [
    ['Generate tokens', 'Color, type and spacing tokens', '/ui-design-system generate tokens for '],
    ['Document components', 'Component docs for handoff', '/ui-design-system document '],
  ],
  'ux-researcher-designer': [
    ['Create personas', 'Data-driven personas', '/ux-researcher-designer personas for '],
    ['Journey map', 'Maps a user journey', '/ux-researcher-designer journey map for '],
    ['Usability test plan', 'Plans a usability test', '/ux-researcher-designer usability test plan for '],
  ],
  'emil-design-eng': [
    ['Polish a component', 'UI polish in Emil Kowalski\'s style', '/emil-design-eng polish '],
    ['Animation advice', 'Should it animate, and how', '/emil-design-eng should this animate: '],
  ],
  'review-animations': [
    ['Review motion code', 'Strict review of animations', '/review-animations '],
  ],
  'animation-vocabulary': [
    ['Name an effect', 'Finds the term for a motion you describe', '/animation-vocabulary what is it called when '],
  ],
  'redesign-skill': [
    ['Audit a design', 'Finds generic AI patterns', '/redesign-skill audit '],
    ['Upgrade a page', 'Applies premium standards, keeps function', '/redesign-skill upgrade '],
  ],
  'taste-skill': [
    ['Build with taste', 'Interface with tuned design dials', '/taste-skill build '],
  ],
  'soft-skill': [
    ['High-end page', 'Agency-grade fonts, shadows, motion', '/soft-skill build '],
  ],
  'minimalist-skill': [
    ['Minimal editorial UI', 'Warm monochrome, flat bento grids', '/minimalist-skill build '],
  ],
  'brutalist-skill': [
    ['Brutalist UI', 'Swiss grids, terminal aesthetic', '/brutalist-skill build '],
  ],
  'gpt-tasteskill': [
    ['Motion-rich page', 'GSAP scroll motion, AIDA structure', '/gpt-tasteskill build '],
  ],
  'stitch-skill': [
    ['Write DESIGN.md', 'Design system file for Google Stitch', '/stitch-skill DESIGN.md for '],
  ],
  'theme-factory': [
    ['Apply a theme', 'Styles an artifact with a preset theme', '/theme-factory apply a theme to '],
    ['Show themes', 'Lists the 10 preset themes', '/theme-factory show the themes'],
    ['Make a theme', 'Creates a new theme', '/theme-factory create a theme for '],
  ],
  'tailwind-patterns': [
    ['Tailwind v4 setup', 'CSS-first config and tokens', '/tailwind-patterns set up '],
    ['Convert to Tailwind', 'Rewrites styles in Tailwind v4', '/tailwind-patterns convert '],
  ],
  brandkit: [
    ['Brand board', 'Brand guidelines board image', '/brandkit brand board for '],
    ['Logo concepts', 'Logo system ideas with meaning', '/brandkit logo concepts for '],
  ],
  'imagegen-frontend-web': [
    ['Website concept', 'Design reference image for a site', '/imagegen-frontend-web '],
  ],
  'imagegen-frontend-mobile': [
    ['App screens', 'Mobile screen concepts in a phone frame', '/imagegen-frontend-mobile '],
  ],
  'image-to-code-skill': [
    ['Design then build', 'Generates a design image, then codes it', '/image-to-code-skill '],
  ],
  figma: [
    ['Implement a frame', 'Turns a Figma node into code', '/figma implement '],
    ['Get a screenshot', 'Fetches a frame as an image', '/figma screenshot of '],
    ['Read variables', 'Pulls tokens from a Figma file', '/figma variables from '],
  ],
  hallmark: [
    ['Design something new', 'A page that looks designed', '/hallmark '],
    ['Redesign a page', 'Redesigns a file you name', '/hallmark redesign '],
    ['Audit a page', 'Reviews a file you name', '/hallmark audit '],
  ],
  stageshow: [
    ['Faux product still', 'Product UI illustration', '/stageshow still of '],
    ['Animated demo', 'Demo with a moving cursor', '/stageshow animated demo of '],
  ],
  'libraries-dev': [
    ['Find an effect', 'Which UI effect fits this project', '/libraries-dev which effect fits '],
    ['Add an effect', 'Installs and wires a library', '/libraries-dev add '],
  ],
  'ios-icon-gen': [
    ['Generate icons', 'PNG imagesets for Xcode', '/ios-icon-gen '],
  ],
  'remotion-video-creation': [
    ['Make a video', 'Video in React with Remotion', '/remotion-video-creation '],
  ],

  // ── Code ──
  'senior-frontend': [
    ['Build a feature', 'React/Next.js/TypeScript work', '/senior-frontend '],
    ['Speed it up', 'Bundle and render performance', '/senior-frontend optimize '],
    ['Scaffold a component', 'New component with types and tests', '/senior-frontend scaffold '],
  ],
  'senior-backend': [
    ['Design an API', 'REST or GraphQL endpoints', '/senior-backend design an API for '],
    ['Optimize queries', 'Database performance', '/senior-backend optimize '],
    ['Add auth', 'Authentication and authorization', '/senior-backend add auth to '],
  ],
  'code-reviewer': [
    ['Review code', 'Best practices and security scan', '/code-reviewer review '],
    ['Review checklist', 'A checklist for this change', '/code-reviewer checklist for '],
  ],
  'clean-code': [
    ['Clean this up', 'Concise code, no over-engineering', '/clean-code '],
  ],
  'karpathy-guidelines': [
    ['Code carefully', 'Think first, small surgical changes', '/karpathy-guidelines '],
  ],
  'output-skill': [
    ['Full output', 'Complete code, no placeholders', '/output-skill '],
  ],
  'git-commit-helper': [
    ['Write a commit message', 'From your staged changes', '/git-commit-helper'],
  ],
  'senior-prompt-engineer': [
    ['Write a prompt', 'Prompt for an LLM feature', '/senior-prompt-engineer write a prompt for '],
    ['Improve a prompt', 'Fixes a prompt you paste', '/senior-prompt-engineer improve: '],
    ['Plan evals', 'How to test a prompt', '/senior-prompt-engineer eval plan for '],
  ],
  'agent-memory-systems': [
    ['Design agent memory', 'Short- and long-term memory setup', '/agent-memory-systems design memory for '],
  ],
  'local-model': [
    ['Hand off to Qwen', 'Bulk or mechanical work to the local model', '/local-model '],
  ],
  graphify: [
    ['Build a graph', 'Knowledge graph of a folder', '/graphify '],
    ['Ask the graph', 'Questions about a graphed codebase', '/graphify query '],
    ['Update the graph', 'Refreshes after changes', '/graphify --update'],
  ],
  seo: [
    ['SEO audit', 'Technical and on-page review', '/seo audit '],
    ['Add schema', 'Structured data markup', '/seo add schema to '],
  ],

  // ── Product and business ──
  'product-manager-toolkit': [
    ['Prioritize with RICE', 'Scores features', '/product-manager-toolkit RICE for '],
    ['Write a PRD', 'Product requirements doc', '/product-manager-toolkit PRD for '],
    ['Analyze interviews', 'Themes from interview notes', '/product-manager-toolkit analyze these interviews: '],
  ],
  'marketing-strategy-pmm': [
    ['Positioning', 'April Dunford positioning', '/marketing-strategy-pmm positioning for '],
    ['Launch plan', 'Go-to-market for a launch', '/marketing-strategy-pmm launch plan for '],
    ['Competitor battlecard', 'Compare against a competitor', '/marketing-strategy-pmm battlecard vs '],
  ],
  'marketing-psychology': [
    ['Apply psychology', 'Mental models for a page or offer', '/marketing-psychology '],
  ],

  // ── Thinking ──
  'grill-me': [
    ['Grill my plan', 'A tough interview to sharpen a plan', '/grill-me '],
  ],
  grilling: [
    ['Stress-test an idea', 'Relentless questions about a decision', '/grilling '],
  ],

  // ── Tools and workspace ──
  caveman: [
    ['Lite', 'Shorter replies, full sentences', '/caveman lite'],
    ['Full', 'Terse replies, about 75% fewer tokens', '/caveman full'],
    ['Ultra', 'As short as possible', '/caveman ultra'],
    ['Turn off', 'Back to normal replies', 'stop caveman'],
  ],
  'file-organizer': [
    ['Organize a folder', 'Suggests a cleaner structure', '/file-organizer organize '],
    ['Find duplicates', 'Lists duplicate files', '/file-organizer find duplicates in '],
  ],
  'emberwake-log': [
    ['Log training', 'Marks a workout done', 'training done'],
    ['Log food', 'Adds what you ate', 'ate '],
    ['Log sleep', 'Hours slept last night', 'slept  hours'],
    ['Check in', 'How you feel today', 'check in: feeling '],
  ],
  scroll: [
    ['Test the scroll', 'Shows a test card', '/scroll test'],
    ['Turn it off', 'No more desktop cards', '/scroll off'],
    ['Turn it on', 'Cards come back', '/scroll on'],
    ['Move it', 'Change where the card shows', '/scroll move to '],
  ],
  'skill-creator': [
    ['New skill', 'Creates a skill from scratch', '/skill-creator create a skill that '],
    ['Improve a skill', 'Edits and tests an existing skill', '/skill-creator improve '],
    ['Run evals', 'Measures how a skill performs', '/skill-creator run evals for '],
  ],
  ponytail: [
    ['Lite', 'Smallest change, light touch', '/ponytail lite'],
    ['Full', 'Smallest complete change', '/ponytail full'],
    ['Ultra', 'Strictest minimal changes', '/ponytail ultra'],
    ['Off', 'Turns ponytail off', '/ponytail off'],
  ],

  // ── Superpowers plugin ──
  brainstorming: [['Brainstorm', 'Explores intent before building', '/superpowers:brainstorming ']],
  'writing-plans': [['Write a plan', 'Turns a spec into steps', '/superpowers:writing-plans ']],
  'executing-plans': [['Run a plan', 'Executes a written plan with checkpoints', '/superpowers:executing-plans ']],
  'systematic-debugging': [['Debug', 'Root-cause method for a bug', '/superpowers:systematic-debugging ']],
  'test-driven-development': [['TDD', 'Red, green, refactor', '/superpowers:test-driven-development ']],
  'verification-before-completion': [['Verify', 'Runs checks before calling it done', '/superpowers:verification-before-completion']],
  'requesting-code-review': [['Request review', 'Reviews finished work', '/superpowers:requesting-code-review']],
  'finishing-a-development-branch': [['Finish branch', 'Merge, PR or clean up', '/superpowers:finishing-a-development-branch']],

  // ── claude.ai skills ──
  docs: [['New doc', 'An editable doc you can share', 'Make a doc: ']],
  docx: [['Word document', 'Creates or edits a .docx', 'Make a Word document: ']],
  pdf: [
    ['Read a PDF', 'Extracts text and tables', 'Read this PDF: '],
    ['Make a PDF', 'Creates a PDF', 'Make a PDF: '],
    ['Merge PDFs', 'Combines several PDFs', 'Merge these PDFs: '],
  ],
  pptx: [['PowerPoint deck', 'Creates a .pptx file', 'Make a PowerPoint deck: ']],
  xlsx: [['Spreadsheet', 'Creates or edits an .xlsx', 'Make a spreadsheet: ']],
  morning: [['Morning brief', 'Today at a glance', '/morning']],
  'import-memory': [['Import memory', 'From another AI assistant', '/import-memory']],
};
