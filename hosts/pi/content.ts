import { dirname, relative } from 'node:path'

export type ContentContext = { plugin: 'dossier' | 'whetstone'; path: string; skills: ReadonlyMap<string, string> }

function instructions(context: ContentContext): string {
  const root = relative(dirname(context.path), '.') || '.'
  const variable = context.plugin === 'dossier' ? 'DOSSIER_PLUGIN_ROOT' : 'WHETSTONE_PLUGIN_ROOT'
  return `## Pi runtime\n\nResolve bundled paths against this file, not the project working directory. The plugin root is \`${root}\` from this file's directory. Before each shell call that uses \`$${variable}\`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.\n\nLoad another installed skill with \`read\` on its advertised SKILL.md path; user commands use \`/skill:<name>\`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check \`../whetstone/bin/<tool>\` relative to dossier's plugin root; if absent, use the documented absent-skip result.\n\nUse \`read/edit/write/bash/grep/find\` for the corresponding host operations. Fresh missions use \`dossier_delegate\` or \`whetstone_delegate\` for that plugin's named agents, with unqualified \`agent\` and artifact-only \`task\`. The tool uses the current model unless the operator supplies an exact \`provider/model\`. Builders use \`agent: general-purpose, write: true\`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.\n\nWeb tools and advisor tools are optional. Use installed web tools when present, or read-only \`curl\`/\`gh api\` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; \`/dossier-tasks\` is a read-only view, not a second task store.\n\n`
}

function hostSections(body: string, context: ContentContext): string {
  if (context.plugin === 'dossier' && context.path === 'skills/build/SKILL.md') {
    body = body.replace('Best driven by native `/goal`.', 'Driven by the native `dossier_auto` continuation tool.')
    body = body.replace(
      /^Availability gate per ADAPTERS §whetstone:[^\n]*$/m,
      'Availability: check that `whetstone_delegate` is an available tool. If absent, append §S `ds:build <T-id> doubt=skipped-absent` and continue. If present, call it with `agent: whetstone-doubter` and the artifact-only mission. A provider/authentication failure is a failed check, not sibling absence; report it.',
    )
    body = body.replace(
      /^\*\*run_slice route[^\n]*$/m,
      '**run_slice route (whetstone compose, optional):** check the executable `"$DOSSIER_PLUGIN_ROOT/../whetstone/bin/run-slice"`. If present, run it with `red <test-cmd>`, `green <test-cmd>`, then `full <suite-cmd>`. Red exits nonzero when the test unexpectedly passes. If absent, use raw test commands.',
    )
    body = body.replace(
      /^\*\*Skill-lint route[^\n]*$/m,
      '**Skill-lint route (touched source SKILL.md only):** check `"$DOSSIER_PLUGIN_ROOT/../whetstone/bin/lint-skill"`, then run that executable with the source skill path. Follow `whetstone:skill-smith`. Require exit 0 before commit (model-judgment at commit); absent executable means §S `skill-lint=skipped-absent`. Generated Pi artifacts are immutable: edit and lint shared source, then rebuild.',
    )
    body = body.replace(
      /^\*\*Tiger route[^\n]*$/m,
      '**Tiger route (every build commit).** After staging, run `"$DOSSIER_PLUGIN_ROOT/../whetstone/bin/tiger-check"` on the consuming repository if that executable exists. It checks added staged lines. The verdict is computed; calling it at commit remains model-judgment because no commit hook is installed. Preserve the verdict/exit policy below.',
    )
    body = body.replaceAll('when on `PATH`', 'when the bundled executable exists')
    body = body.replace(
      /^\*\*TaskList mirror:\*\*[^\n]*$/gm,
      'The native dossier task view reads this ledger change directly; there is no separate task mutation.',
    )
    body = body
      .replaceAll('TaskList + transcript', 'dossier task view + transcript')
      .replaceAll('full covenant + TaskList mirror', 'full covenant + ledger view')
    body = body.replace(
      /\*\*Driver — native `\/goal`\.\*\*[\s\S]*?(?=\*\*Decision boundary)/,
      `**Driver — native Pi continuation.** At the start of explicit \`--auto\`, call \`dossier_auto\` with \`action: start\` and the selected wave slug. The extension checks the actual ledger at final settlement. It requests another iteration while agent-owned work remains, stops on a new PAUSE/auto-stop line, and stops after repeated lack of ledger progress. This is computed continuation, not a fresh model evaluator. Every decision boundary below still needs the operator. \`/dossier-auto stop\` or Escape ends the driver. Session changes also stop it.\n\n`,
    )
    body = body.replace(
      /Then `SendMessage` the same builder:/g,
      'Then call `dossier_delegate` again with `agent: general-purpose, write: true`, the same artifact-only mission and:',
    )
    body = body.replace(/Without `SendMessage`, or on a resume where the builder is gone,/g, 'Each delegated session is fresh; on a resume,')
    body = body.replace(
      /`SendMessage` the builder the Critical findings/g,
      'call `dossier_delegate` with `agent: general-purpose, write: true`, the mission and Critical findings',
    )
    body = body.replace(
      /^\*\*Where this actually resolves\.\*\*[^\n]*$/m,
      '**Where this resolves on Pi.** Resolve the sibling whetstone bin path described above, then check whether that executable exists. Pi does not add it to PATH. When absent, record `tiger=skipped-absent` and continue.',
    )
    body = body.replace(
      /with `agent: general-purpose` and no `model`,[^.]+\./,
      'with `agent: general-purpose, write: true` and no `model`, so it uses the current Pi model.',
    )
  }
  if (context.plugin === 'dossier' && context.path === 'skills/status/SKILL.md') {
    body = body.replace(
      /### 2a\. Hydrate TaskList[^\n]*\n[\s\S]*?(?=### 3\.)/,
      '### 2a. Native task view\n\nThe Pi extension reads §T for the status widget and `/dossier-tasks`. It writes no task mirror. Keep `who=H`, `!` and `?` rows for the operator.\n\n',
    )
    body = body
      .replaceAll(' and the TaskList hydration', '')
      .replace(
        /^1\. \*\*transcripts\*\*[^\n]*$/m,
        '1. **transcripts** — use the current conversation or a session export/path supplied by the operator. Ask for that path when older context is needed; do not assume a home-directory layout. Header `## Recovered (transcripts)`.',
      )
  }
  if (context.plugin === 'dossier' && context.path === 'skills/backprop/SKILL.md') {
    body = body.replace(
      /^For a bug that IS a failing test,[^\n]*$/m,
      'For a bug that IS a failing test, check `"$DOSSIER_PLUGIN_ROOT/../whetstone/bin/flake-runner"`. If absent, record §S `flake-triage=skipped` and proceed to step 5. If present, use its absolute path for the triage below.',
    )
  }
  if (context.plugin === 'dossier' && context.path === 'skills/check/SKILL.md') {
    body = body.replace(
      /^§X repos > 2 and `Workflow` present[^\n]*$/m,
      'Dispatch fresh `dossier_delegate` scout calls with artifact-only missions. Validate the returned findings against the table above. This fan-out has no Workflow cache or crash-recovery promise; the dossier remains the recovery artifact.',
    )
  }
  if (context.plugin === 'whetstone' && context.path === 'skills/doubt-pass/SKILL.md') {
    body = body.replace(
      /^- \*\*Model\*\*[^\n]*$/m,
      "- **Model** — use the current Pi model. Only an explicit operator-supplied `provider/model` overrides it. Do not read another host's settings or guess a model family alias.",
    )
  }
  if (context.plugin === 'whetstone' && context.path === 'skills/research-report/SKILL.md') {
    body = body.replace(
      'The user invoked this skill by name: go on. Claude routed it: ask once, because the run spawns several agents and a workflow, then go on after a yes.',
      'An explicit request for this research report is consent to the described fan-out. If you selected this method without that request, ask once before spawning agents.',
    )
    body = body.replace(
      'Run the `whetstone:verify-claims` workflow with `args: { question, claims, batch: 5 }`.',
      'Call `whetstone_verify_claims` with `{ question, claims, batch: 5 }`. Its results are model-judgment; malformed or missing rulings are `UNRULED`.',
    )
  }
  if (context.plugin === 'whetstone' && context.path === 'skills/grill/SKILL.md') {
    body = body.replace(
      'In a repository with `.scratchpad/dossier/`,',
      'When the installed skills include `dossier-grill` and the repo has `.scratchpad/dossier/`,',
    )
  }
  if (context.plugin === 'whetstone' && context.path === 'skills/html-report/SKILL.md') {
    body = body
      .replace('CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" ', '')
      .replaceAll('${CLAUDE_PLUGIN_DATA}/html-report', "the renderer's XDG cache directory (`~/.cache/whetstone/html-report` by default)")
  }
  return body
}

export function transformMarkdown(text: string, context: ContentContext): string {
  const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0] ?? ''
  let body = text.slice(frontmatter.length)
  if (context.path === 'ADAPTERS.md') {
    body =
      '# Pi adapters\n\nThe native extensions register independent delegation tools and lifecycle hooks. Use `dossier_delegate` for dossier missions, `whetstone_delegate` for whetstone missions, and `whetstone_verify_claims` for sourced grounding. Check tool availability before a sibling route. Missing siblings are skipped. Optional context7 and web tools remain detect-and-skip. No Workflow API or Claude settings are required.\n'
  }
  body = hostSections(body, context)
  body = body.replace(/(["']?)\$\{CLAUDE_PLUGIN_ROOT\}\1/g, `"$${context.plugin === 'dossier' ? 'DOSSIER' : 'WHETSTONE'}_PLUGIN_ROOT"`)
  body = body.replaceAll('$ARGUMENTS', 'the request appended to this skill')
  if (context.plugin === 'dossier')
    body = body.replace(/`(run-slice|lint-skill|tiger-check|flake-runner)([^`\n]*)`/g, '`"$DOSSIER_PLUGIN_ROOT/../whetstone/bin/$1"$2`')
  body = body.replace(/`\/?((?:dossier|ds|whetstone):[a-z][a-z0-9-]*)`/g, (original, reference: string) => {
    if (/^(?:dossier:dossier-|whetstone:whetstone-)/.test(reference)) return `\`${reference.slice(reference.indexOf(':') + 1)}\``
    const mapped = context.skills.get(reference) ?? reference.replace(/^ds:/, 'dossier:').replace(':', '-')
    return `\`/skill:${mapped}\``
  })
  body = body.replace(/\/dossier:([a-z][a-z0-9-]*)/g, '/skill:dossier-$1').replace(/\/whetstone:([a-z][a-z0-9-]*)/g, '/skill:whetstone-$1')
  body = body
    .split('\n')
    .map((line) => line.replaceAll('`Agent`', `\`${line.includes('whetstone-') ? 'whetstone' : context.plugin}_delegate\``))
    .join('\n')
    .replaceAll('subagent_type:', 'agent:')
  body = body.replace(
    "with `agent: general-purpose` and no `model`, so the builder runs on the user's subagent default or the session model.",
    'with `agent: general-purpose, write: true` and no `model`, so the builder uses the current Pi model.',
  )
  body = body.replace(/(agent:\s*)(?:dossier:|whetstone:)([a-z][a-z0-9-]*)/g, '$1$2')
  const entry = /^skills\/[^/]+\/SKILL\.md$/.test(context.path) || !context.path.includes('/')
  return frontmatter + (entry ? instructions(context) : '') + body
}
