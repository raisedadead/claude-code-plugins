# claude-code-plugins

> Personal Claude Code plugins by @raisedadead.

Marketplace name: `raisedadead-plugins`.

## Plugins

| Plugin                      | Description                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [dossier](plugins/dossier/) | Phase-scoped engineering workflow with single-file DOSSIER.md, resumable builds, drift detection, evidence log, cross-repo state |

## Install

In Claude Code:

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
```

## Repo layout

```
.
├── .claude-plugin/marketplace.json
├── plugins/
│   └── dossier/
│       ├── .claude-plugin/plugin.json
│       ├── hooks/
│       ├── agents/
│       ├── skills/
│       ├── FORMAT.md
│       ├── ADAPTERS.md
│       └── README.md
├── LICENSE
└── README.md
```

## License

ISC License - see [LICENSE](./LICENSE) file for details.
