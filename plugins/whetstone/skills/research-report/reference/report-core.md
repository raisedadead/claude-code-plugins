# Report core

A fixed core that every report carries, in this order, plus the optional sections the question needs. `html-report` moves `Summary`, `Decisions for you` and `Sources` to their places by the heading text, so keep those three headings exactly.

## The core

```markdown
# <Title: the question as a statement>

Date: <YYYY-MM-DD>. Question: <one sentence>. Probed on: <host, versions>.

## Summary

- **<Result in bold.>** <One or two sentences with the number that proves it.>
- 3 to 5 bullets. The reader who stops here knows the answer.

## Decisions for you

| # | Decision | Options | Recommended | Why |
| - | -------- | ------- | ----------- | --- |

<Omit this section when nothing needs the reader's choice.>

## 1. Evidence

<What the sources say, one subsection per facet. A table when 3 or more items share columns.>

## 2. Our probes

<What the local probes measured, with the command for each number.>

## 3. Recommendation

<What to do, and when it loses: the condition under which another option wins.>

## 4. Risks and open items

<Each `UNVERIFIED:` claim and each open question, with what would settle it.>

## Sources

1. [key] <title> — <URL>, <date>
```

Optional sections go between Evidence and Recommendation: baseline, goals and targets, design with diagrams, candidates compared, plan, migration.

## Reader rules

- Write plain English. Short sentences, active voice, one idea per paragraph.
- Define each term at its first use. Expand each abbreviation once.
- Start each section with one sentence that states its result.
- Give every number its unit and its source.
- Put a decision in `Decisions for you` only when the reader must choose. Give each one a recommendation.
- Use a diagram when it replaces a paragraph of explanation. Give it `accTitle:` and `accDescr:`.
- Keep conflicting sources as separate rows; say which one the report trusts and why.
