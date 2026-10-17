# Ontology edge cases

Load when structuring money/obligations, correcting claims, indexing, or publishing selected assertions. Follow `get_ontology` for the live schema; a single example never defines the schema.

## Contents

- Core domain coverage
- Money and obligations
- Routines, events, preferences
- Evidence and inference
- Corrections and supersedes
- Indexing and semantic search
- Publishing claims

## Core domain coverage

The core covers people and relationships, organizations/work, places, events/plans, projects, tasks, goals, decisions, contextual preferences, routines, possessions/services, and obligations. Reuse established entity keys only when identity is clear; keys are author-scoped and names alone never merge identities. Prefer precise predicates over ABOUT. A desire is not employment, an assignment is not acceptance, a visit is not residence, and a concern is not a diagnosis. Negated or hypothetical statements must not become affirmative claims. If the schema cannot express a statement faithfully, preserve the source wording. Automatic extraction is model-generated and can need correction; schema/evidence validation does not prove semantic truth.

## Money and obligations

For money, create a distinct obligation key per reported debt. Link debtor `--OWES-->` obligation `--OWED_TO-->` creditor, with `HAS_AMOUNT` as an exact decimal string and `HAS_CURRENCY` only for an explicitly known ISO currency. Keep purchase context with `FOR_CONTEXT`. Do not infer USD from "dollars", a repayment deadline, settlement, accepted liability, or a balance after partial payments.

## Routines, events, preferences

Recurring activities use routine; dated occurrences use event. Contextual preferences use preference / `PREFERENCE_OF` / `APPLIES_TO` / `HAS_VALUE`; do not convert a context-specific instruction into a universal trait. Do not turn “can start” into acceptance or completion.

## Evidence and inference

Each claim’s evidence must be an exact source excerpt. Keep any useful inference labeled `inferred`; do not manufacture an explicit statement or record unadopted proposals as commitments.

## Corrections and supersedes

When correcting a source, inspect its automatic ontology receipt; old private claims no longer appear by default. Use `supersedes` only for a correction of the same author’s same subject/predicate. Preserve differing authors’ claims and show uncertainty.

## Indexing and semantic search

Use `recall_knowledge` for structured questions, predicate/entity filters, and applicable-time bounds. Standard `recall` also returns a knowledge packet when supported. Semantic search finds paraphrases; similarity is a relevance signal, never proof of truth or identity. Check `semanticSearch` for unavailable/`not_configured` states. If historical claims predate indexing, use `index_knowledge` in bounded batches and inspect `pending`/`hasMore`; it indexes current authored claims without changing their meaning or sharing them. Missing validity remains unknown; older assertions are history, not automatically the historical truth.

## Publishing claims

Only when the user explicitly selects an assertion for a space, use `publish_claim` with `userRequested: true`. This creates an immutable snapshot of that assertion, evidence excerpt, and entity names. Do not use whole-memory `share_memory` for this operation. Private source text, other claims, aliases, and entity properties remain private. Source edits do not silently republish snapshots. `publish_claim` with `enabled: false` withdraws the selected publication; retries cannot reactivate it. Forgetting a source removes its derived claims/publications. Ontology publications currently support on-demand retrieval only; do not claim they triggered a proactive notification.
