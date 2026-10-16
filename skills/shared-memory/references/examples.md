# Concrete operating examples

Load when unsure how to phrase a save, acknowledgement, or share. Patterns are illustrative; always use real tool receipts.

## Save a preference

**User:** “Please keep answers short — bullet points when you can.”

1. `recall` with query about communication / brevity preferences (avoid duplicates).
2. `remember` with roughly:
   - `text`: “User prefers concise answers, preferably bullet points.”
   - `kind`: `preference`
   - `basis`: `user_statement`
   - `evidence`: the user’s short quote
   - `idempotencyKey`: stable for this statement
3. On success: “Saved your preference for concise, bullet-point answers.”

## Do not save

**User:** “What if I preferred dark mode?” (hypothetical) → do not `remember` as a preference.

**User:** pastes an API token “for debugging” → refuse to store credentials; ask them to rotate if exposed.

## Correct a memory

**User:** “Actually I use Notion, not Linear, for tasks.”

1. `recall` / locate the current memory and revision.
2. `revise_memory` with `expectedRevision`, corrected `text`/`evidence`, same event semantics where appropriate.
3. Acknowledge only after the revision receipt.

## Share an update

**User:** “Tell Roshan I finished the OAuth fix.”

1. `list_spaces` → pick the space that includes Roshan; confirm contributor/owner role.
2. `remember` the completion if not already saved.
3. `share_memory` with `userRequested: true` and a stable `idempotencyKey`.
4. Acknowledge the share receipt; do not claim Roshan’s agent already notified him unless a monitoring receipt on their side exists (it will not appear here).

## Publish one claim (ontology)

**User:** “Publish just the ‘I work at Acme’ claim into our shared space.”

1. Confirm the claim ID from a prior `remember`/`recall_knowledge`/`explain` path.
2. `publish_claim` with `userRequested: true` — not `share_memory`.
3. Do not claim a webhook fired; ontology publications are on-demand retrieval.
