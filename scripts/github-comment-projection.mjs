import { Buffer } from 'buffer'
import { parseRoleCommentBody } from './mission-control-reconcile.mjs'

export function projectComments(comments = []) {
  if (!Array.isArray(comments)) return comments

  const authoritativeComments = new Set()
  for (const comment of comments) {
    const body = comment.body || comment.body_html || ''
    const parsed = parseRoleCommentBody(body)
    
    if (parsed && parsed.role) {
      authoritativeComments.add(comment)
    }
  }

  return comments.map(rawComment => {
    let body = rawComment.body
    if (!body && rawComment.body_html) {
      body = rawComment.body_html
    } else if (!body) {
      body = ''
    }

    const isAuthoritative = authoritativeComments.has(rawComment)
    const isFounderDecision = 
      body.includes('founder_decision:') || 
      body.includes('Founder decision:') || 
      /\b[Ff]ounder\s+gate:\s*Required\b/.test(body) || 
      body.includes('ELIGIBLE FOR FOUNDER REVIEW')

    let projectedBody = body
    if (!isAuthoritative && !isFounderDecision) {
      const parsed = parseRoleCommentBody(body)
      if (parsed && parsed.role) {
        projectedBody = `[Superseded ${parsed.role} comment. View original at ${rawComment.url || 'GitHub'}]`
      } else if (body.length > 500) {
        projectedBody = body.substring(0, 500) + `...\n\n[Comment truncated for context size. View full comment at ${rawComment.url || 'GitHub'}]`
      }
    }

    const projected = {
      id: rawComment.id || rawComment.node_id,
      url: rawComment.url,
      author: rawComment.author?.login || rawComment.user?.login || 'unknown',
      createdAt: rawComment.createdAt || rawComment.created_at,
      body: projectedBody
    }
    
    if (rawComment.path) projected.path = rawComment.path
    if (rawComment.line) projected.line = rawComment.line
    if (rawComment.inReplyTo || rawComment.in_reply_to_id) {
      projected.inReplyTo = rawComment.inReplyTo || rawComment.in_reply_to_id
    }
    if (rawComment.updatedAt || rawComment.updated_at) {
      projected.updatedAt = rawComment.updatedAt || rawComment.updated_at
    }
    if (rawComment.pullRequestReviewId || rawComment.pull_request_review_id) {
      projected.pullRequestReviewId = rawComment.pullRequestReviewId || rawComment.pull_request_review_id
    }
    if (rawComment.side !== undefined) projected.side = rawComment.side
    if (rawComment.startLine || rawComment.start_line) {
      projected.startLine = rawComment.startLine || rawComment.start_line
    }
    if (rawComment.startSide || rawComment.start_side) {
      projected.startSide = rawComment.startSide || rawComment.start_side
    }
    
    return projected
  })
}

export function benchmarkProjection(rawComments, projectedComments) {
  const rawJson = JSON.stringify(rawComments) || '[]'
  const projJson = JSON.stringify(projectedComments) || '[]'
  
  return {
    rawBytes: Buffer.byteLength(rawJson, 'utf8'),
    rawTokens: Math.ceil(rawJson.length / 4),
    projectedBytes: Buffer.byteLength(projJson, 'utf8'),
    projectedTokens: Math.ceil(projJson.length / 4)
  }
}
