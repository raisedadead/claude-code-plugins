---
name: html-report
description: Render a markdown report as one self-contained HTML page for a human reader, in plain English, with the answer first, a table of contents and Mermaid diagrams drawn as images. Use when the user asks for an HTML report, or for a readable page made from a markdown document.
---

# html-report — one page a person can read without help

The reader gets the answer first, the decisions second and the evidence after. The renderer moves the sections; the writer supplies plain text that earns each place.

## Run it

```bash
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PLUGIN_ROOT}"/bin/html-report <report.md> <report.html>
```

The first run installs the pinned renderer (`marked`, `@mermaid-js/mermaid-cli`, `puppeteer`) into `${CLAUDE_PLUGIN_DATA}/html-report`. A later run installs again only when `package-lock.json` changes. The renderer drives the local Chrome or Chromium and downloads no browser.

| exit | meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0    | `wrote <report.html>`; with diagrams, also `figures: <dir> (<n>)`                                  |
| 1    | a Mermaid diagram did not parse: `diagram <n> ("<first line>"): <error>`; the target holds no HTML |
| 64   | usage error, or the markdown cannot be read                                                        |
| 69   | no Chrome or Chromium, the browser did not start, or the install failed; the markdown stays        |

`PUPPETEER_EXECUTABLE_PATH` selects the browser. When it names a missing path, the renderer stops with exit 69 and searches no further.

## What the layout does with your headings

The renderer matches an `##` heading by its whole text, after it removes a leading number such as `3.` or `0.`:

| heading                                    | goes to                                    |
| ------------------------------------------ | ------------------------------------------ |
| `Summary`, `Answer`, `The answer`, `TL;DR` | a blue box at the top, labelled The answer |
| `Decisions`, `Decisions for you`           | an amber box below it                      |
| `Sources`, `References`                    | a closed section at the end                |
| any other heading                          | the body, in source order                  |

A heading such as `Decision log` stays in the body. The table of contents lists the body `##` and `###` headings. A table with more than 12 rows closes behind a `Show table` control, except in the decisions box. The first paragraph after each body `##` shows as the section's result.

## Write for the reader

The reader did not see the work. Write plain English with fewer words: short sentences, the active voice, one idea in each paragraph. Go technical only when the reader asks for it.

- Name a thing by what it does, not by a working label such as a task ID, a ledger row or a pane name. "The opt-in line, added now" is clear; "T13" is not.
- Define each technical term at its first use. Expand each abbreviation once. With 3 or more terms, add a short word list.
- Give every number its unit and its source. Put the source in a short reference, such as a `path:line`, a URL or a command. Do not narrate the probe.
- Put the risks in a table of what can go wrong and the fix for each.
- Put a decision in `Decisions` only when the reader must choose. Give each one a recommendation.
- Use a diagram when it replaces a paragraph of explanation.

## Write for the layout

- Put the answer in 3 to 5 bullets. Start each bullet with its result in bold.
- Start each body section with one sentence that states its result.
- Give each Mermaid diagram an `accTitle:` and an `accDescr:` line. They become the image's alternative text; without them the text is `Diagram <n>`.
- Keep a diagram shorter than one screen. Split a tall diagram, or use `flowchart LR`.

## Check before you hand it over

1. Read every PNG in the `figures:` directory. Each is a screenshot of one diagram as the page shows it.
1. A label is clipped or overlaps, or a diagram is too small to read: fix the Mermaid source and run again.
1. Read each `looks like a working label` line. Rename the label, or define it on the page, and run again. A label that the page defines can stay.
1. Give the reader the HTML path. The file holds its styles and its images, so it opens offline.

## Honesty labels

| claim                                          | enforced by                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| a diagram that does not parse stops the render | code — exit 1; an earlier page at the target is removed                                                              |
| no local browser stops the render              | code — exit 69 before any install                                                                                    |
| the answer box holds 3 to 5 bullets            | model-judgment — the renderer moves the section and counts nothing                                                   |
| each diagram is legible                        | model-judgment — the screenshots exist; reading them is the check                                                    |
| a working label in the prose is reported       | advisory — one stderr line per label, exit 0; fenced code, inline code, comments and open-item lines are not scanned |
| the page reads as plain English                | model-judgment — the scan finds labels, not jargon                                                                   |

PDF output and hosting are out of scope.
