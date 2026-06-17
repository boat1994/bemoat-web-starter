import * as migration_20250929_111647 from './20250929_111647'
import * as migration_20260617_070234_prod_missing_payload_tables from './20260617_070234_prod_missing_payload_tables'

export const migrations = [
  {
    up: migration_20250929_111647.up,
    down: migration_20250929_111647.down,
    name: '20250929_111647',
  },
  {
    up: migration_20260617_070234_prod_missing_payload_tables.up,
    down: migration_20260617_070234_prod_missing_payload_tables.down,
    name: '20260617_070234_prod_missing_payload_tables',
  },
]
