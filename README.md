# claude-code-plugins

> Personal Claude Code plugins by @raisedadead.

Marketplace name: `raisedadead-plugins`.

## Plugins

| Plugin                          | Description                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [dossier](plugins/dossier/)     | Phase-scoped engineering workflow with single-file DOSSIER.md, resumable builds, drift detection, evidence log, cross-repo state  |
| [whetstone](plugins/whetstone/) | Engineering-craft skills with deterministic self-verify: red-green TDD, flaky-test audit, doubt review, merge-resolve, skill lint |

Designed as a pair: dossier is the ledger that drives a wave of work; whetstone is the per-task craft it composes at phase gates (doubt at design, run_slice at RED/GREEN, merge-resolve on conflicts, skill-smith on skill authoring — see dossier `ADAPTERS.md` §whetstone and the shared **Verdict grammar** table in both plugin READMEs). Either plugin works alone — every composition route detects and skips silently when the sibling is absent.

## Install

In Claude Code:

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
/plugin install whetstone@raisedadead-plugins
```

Both installs recommended (the pair composes); each is fully functional standalone.

## Repo layout

```
.
├── .claude-plugin/marketplace.json
├── plugins/
│   ├── dossier/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── hooks/
│   │   ├── agents/
│   │   ├── skills/
│   │   ├── FORMAT.md
│   │   ├── ADAPTERS.md
│   │   └── README.md
│   └── whetstone/
│       ├── .claude-plugin/plugin.json
│       ├── agents/
│       ├── skills/
│       ├── tests/
│       └── README.md
├── LICENSE
└── README.md
```

## License

ISC License - see [LICENSE](./LICENSE) file for details.
