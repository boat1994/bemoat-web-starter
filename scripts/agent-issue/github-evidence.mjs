const databaseIdPattern = /#issuecomment-(\d+)$/

function commentDatabaseIdFromUrl(url) {
  if (typeof url !== 'string') return null
  return url.match(databaseIdPattern)?.[1] ?? null
}

function normalizeDatabaseId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value
  return null
}

function distinct(values) {
  return [...new Set(values.filter(Boolean))]
}

export function normalizeCanonicalGitHubComment(graphqlComment = {}, restComment = null) {
  const graphqlUrl = graphqlComment.url ?? graphqlComment.html_url ?? null
  const restUrl = restComment?.html_url ?? restComment?.url ?? null
  const databaseIds = distinct([
    normalizeDatabaseId(graphqlComment.databaseId ?? graphqlComment.database_id),
    normalizeDatabaseId(graphqlComment.id),
    commentDatabaseIdFromUrl(graphqlUrl),
    normalizeDatabaseId(restComment?.id ?? restComment?.databaseId ?? restComment?.database_id),
    commentDatabaseIdFromUrl(restUrl),
  ])

  if (databaseIds.length > 1) {
    return {
      ok: false,
      errors: ['STATE CONFLICT: GitHub comment database identity is contradictory'],
      comment: null,
    }
  }

  const databaseId = databaseIds[0] ?? null
  const graphqlId = graphqlComment.id ?? graphqlComment.node_id ?? null
  const nodeId = typeof graphqlId === 'string' && !/^\d+$/.test(graphqlId)
    ? graphqlId
    : graphqlComment.nodeId ?? null
  const author = restComment?.user?.login ?? graphqlComment.author?.login ?? graphqlComment.user?.login ?? 'unknown'
  const authorAssociation = restComment?.author_association ?? graphqlComment.authorAssociation ?? graphqlComment.author_association ?? null
  const createdAt = restComment?.created_at ?? graphqlComment.createdAt ?? graphqlComment.created_at ?? null
  const updatedAt = restComment?.updated_at ?? graphqlComment.updatedAt ?? graphqlComment.updated_at ?? null

  return {
    ok: true,
    errors: [],
    comment: {
      id: databaseId,
      databaseId,
      nodeId,
      url: restUrl ?? graphqlUrl,
      author,
      authorAssociation,
      body: restComment?.body ?? graphqlComment.body ?? graphqlComment.body_html ?? '',
      createdAt,
      updatedAt,
    },
  }
}

function defaultRunCommand(command, args, { cwd, env }) {
  throw new Error(`No command runner configured for ${command} ${args.join(' ')} in ${cwd ?? process.cwd()} (${env ? 'environment provided' : 'default environment'})`)
}

function parseJsonResult(result, invalidJsonPrefix) {
  if (result.error) {
    return { ok: false, reason: `GitHub CLI is unavailable: ${result.error.message}` }
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: result.stderr.trim() || result.stdout.trim() || 'GitHub CLI request failed.',
    }
  }

  try {
    return { ok: true, value: JSON.parse(result.stdout) }
  } catch (error) {
    return {
      ok: false,
      reason: `${invalidJsonPrefix}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function createGitHubEvidenceAdapter({
  cwd = process.cwd(),
  env = process.env,
  defaultRepo = null,
  runCommand = defaultRunCommand,
} = {}) {
  function execute(args) {
    return runCommand('gh', args, { cwd, env })
  }

  return {
    fetchIssueComments(issueNumber) {
      if (!issueNumber) {
        return { ok: false, reason: 'Issue number is required for comment lookup.' }
      }

      const args = ['issue', 'view', String(issueNumber), '--json', 'comments']
      if (defaultRepo) args.push('--repo', defaultRepo)
      const parsed = parseJsonResult(execute(args), 'Invalid issue comments JSON')
      if (!parsed.ok) return parsed

      const rawComments = Array.isArray(parsed.value?.comments) ? parsed.value.comments : []
      const comments = []
      for (const rawComment of rawComments) {
        const normalized = normalizeCanonicalGitHubComment(rawComment)
        if (!normalized.ok) {
          return { ok: false, reason: normalized.errors.join('\n') }
        }
        comments.push(normalized.comment?.databaseId ? normalized.comment : rawComment)
      }

      return { ok: true, comments, rawComments }
    },

    fetchCommentByDatabaseId(databaseId) {
      const normalizedId = normalizeDatabaseId(databaseId)
      if (!normalizedId) {
        return { ok: false, reason: `Invalid GitHub comment database id: ${databaseId}` }
      }
      if (!defaultRepo) {
        return { ok: false, reason: 'GitHub repository is required for comment lookup.' }
      }

      const parsed = parseJsonResult(
        execute(['api', `repos/${defaultRepo}/issues/comments/${normalizedId}`]),
        'Invalid issue comment JSON',
      )
      if (!parsed.ok) return parsed

      const normalized = normalizeCanonicalGitHubComment({}, parsed.value)
      return normalized.ok
        ? { ok: true, comment: normalized.comment, rawComment: parsed.value }
        : { ok: false, reason: normalized.errors.join('\n') }
    },
  }
}
