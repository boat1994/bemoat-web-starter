/**
 * Pure campaign projection enums and marker constants.
 * No GitHub, filesystem, process, or command execution.
 */

export const CAMPAIGN_MARKER_START = '<!-- bemoat-mission-control-campaign:start -->'
export const CAMPAIGN_MARKER_END = '<!-- bemoat-mission-control-campaign:end -->'

export const CAMPAIGN_MARKER_START_RE = /<!--\s*bemoat-mission-control-campaign:start\s*-->/g
export const CAMPAIGN_MARKER_END_RE = /<!--\s*bemoat-mission-control-campaign:end\s*-->/g

export const TASK_MARKER_START_RE = /<!--\s*bemoat-mission-control-state:start\s*-->/g
export const TASK_MARKER_END_RE = /<!--\s*bemoat-mission-control-state:end\s*-->/g

export const CAMPAIGN_LIFECYCLES = new Set<string>(['PLANNING', 'ACTIVE', 'BLOCKED', 'COMPLETE'])

export const SLICE_STATUSES = new Set<string>([
  'NOT_STARTED',
  'PLANNING',
  'IN_PROGRESS',
  'AWAITING_REVIEW',
  'ELIGIBLE_FOR_FOUNDER_REVIEW',
  'BLOCKED',
  'DONE',
])

export const ROOT_SCRIPT_MAP_VALIDATION_STATUSES = new Set<string>([
  'PENDING_IMPLEMENTATION',
  'PENDING_EXPANDED_IMPLEMENTATION',
  'VALID',
  'INVALID',
])

export const FACADE_DISPOSITIONS = new Set<string>([
  'stable_facade',
  'composition_root',
  'tooling_entrypoint',
])

export const MIGRATION_STATUSES = new Set<string>([
  'unmapped',
  'planned',
  'transitional',
  'migrated',
  'retained',
])

export const INTERNAL_DESTINATION_PREFIXES = Object.freeze([

  'scripts/context/',
  'scripts/mission-control/',
  'scripts/agent-issue/',
  'scripts/boilerplate/',
  'scripts/guards/',
  'scripts/adapters/',
  'scripts/tooling/',
  'scripts/shared/',
])

export const SLICE_KEYS = Object.freeze(['1', '2', '3', '4', '5', '6', '7'])

export const CAMPAIGN_REQUIRED_KEYS = Object.freeze([
  'schema_version',
  'campaign_issue',
  'campaign_lifecycle',
  'approved_base',
  'architecture_authority',
  'slices',
  'root_script_map',
  'campaign_blockers',
  'next_permitted_action',
  'updated_at',
  'updated_by',
])

export const SLICE_REQUIRED_KEYS = Object.freeze([
  'status',
  'issue',
  'pr',
  'reviewed_head',
  'merged_commit',
  'authority_comment_ids',
  'blocker_ids',
])

export const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i
