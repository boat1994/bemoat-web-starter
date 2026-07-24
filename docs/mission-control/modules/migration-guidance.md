## Existing-task migration behavior

For a managed existing task already under review without a valid state block:

1. Reconstruct prior completed review rounds from Issue/PR comments where evidence is clear.
2. Record the reconstructed count and reviewed SHAs.
3. If the count cannot be proven, ask the Founder to set the starting cycle once.
4. Do not grant a fresh three-cycle budget by default.
5. Return `STATE_MIGRATION_REQUIRED` until migration is complete.


