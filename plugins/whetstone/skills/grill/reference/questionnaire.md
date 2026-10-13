# Questionnaire for a decision the user cannot answer

The recipient holds knowledge the user lacks; the questionnaire draws it out. Ask the user only about the send, which they can always answer:

1. **Who receives it?** Their role, their expertise and their relationship to the user. This sets the tone and how much context the document carries.
1. **What must come back?** The decisions or facts the user cannot settle alone. Done when each one is a concrete item.
1. **Write it** to `questionnaire-<slug>.md` in the current directory, using the structure below, and give the user the path. Done when each item from step 2 has a question.

## Document structure

Frame the document as a **discovery questionnaire**: the user lacks context, the recipient holds it. Order questions most-important-first, since async means you may only get one pass, and group them under `##` headings by theme once there are more than a handful. Write it using the template below.

<questionnaire-template>

# <Questionnaire title>

**Purpose:** why this questionnaire exists and the decision riding on it.

**From:** <the user>, **To:** <the recipient>, **How your answers will be used:** <where they go>

## Context

One paragraph orienting a recipient who wasn't in the user's head. Enough to answer well, not a page.

## How to answer

Deadline and rough effort. Partial answers and "I don't know" are useful: flag anything you're unsure of rather than skipping it.

## <Theme heading>

One `##` section per theme. Under each, its questions, most-important-first. Every question is one idea, never compound, with an answer stub directly beneath, and a one-line _why this matters_ only where the question could be misread or invite a throwaway answer.

<question-example>
### What load is the system expected to handle at launch?

_Why this matters: it decides whether we provision for burst traffic now or defer it._

>
</question-example>

## Anything else?

A closing catch-all: anything we didn't ask that we should know?

</questionnaire-template>
