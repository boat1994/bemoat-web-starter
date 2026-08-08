export function founderMergeTransitionAuthorized({
  mergeAuthorized = false,
  migrationAuthorized = false,
  deployAuthorized = false,
} = {}) {
  return {
    mergeAllowed: mergeAuthorized,
    migrationAllowed: migrationAuthorized,
    deployAllowed: deployAuthorized,
    boundedSequence: mergeAuthorized && !migrationAuthorized && !deployAuthorized,
  }
}
