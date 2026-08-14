const STATIC_IMPORT_FROM_RE =
  /\bimport\s+(?:type\s+)?(?:[^;]*?\sfrom\s+)?['"]([^'"]+)['"]/g
const EXPORT_FROM_RE =
  /\bexport\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_START_RE =
  /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r\n?|\n|$))*\(/g

type ImportSpecifierEntry = {
  specifier: string
  sourceExpression: string
}

type RuntimeImportParseResult = {
  specifiers: ImportSpecifierEntry[]
  unverifiable: ImportSpecifierEntry[]
}

function normalizeDynamicImportSourceExpression(sourceExpression: string): string {
  return sourceExpression.replace(/\s+/g, ' ').trim()
}

function findDynamicImportInvocations(content: string) {
  const invocations: Array<{ sourceExpression: string; argumentExpression: string }> = []

  for (const match of content.matchAll(DYNAMIC_IMPORT_START_RE)) {
    if (match.index == null) continue

    const start = match.index
    const openParen = start + match[0].lastIndexOf('(')
    let quote: "'" | '"' | '`' | null = null
    let escaped = false
    let depth = 1
    let end = content.length

    for (let index = openParen + 1; index < content.length; index += 1) {
      const character = content[index]

      if (quote) {
        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === quote) {
          quote = null
        }
        continue
      }

      if (character === "'" || character === '"' || character === '`') {
        quote = character
        continue
      }

      if (character === '(') {
        depth += 1
        continue
      }

      if (character === ')') {
        depth -= 1
        if (depth === 0) {
          end = index + 1
          break
        }
      }
    }

    const sourceExpression = normalizeDynamicImportSourceExpression(content.slice(start, end))
    invocations.push({
      sourceExpression,
      argumentExpression: content.slice(openParen + 1, end - 1).trim(),
    })
  }

  return invocations
}

function parseExactDynamicImportSpecifier(argumentExpression: string): string | null {
  const singleQuoted = argumentExpression.match(/^'([^'\\\r\n]*)'$/)
  if (singleQuoted) return singleQuoted[1]

  const doubleQuoted = argumentExpression.match(/^"([^"\\\r\n]*)"$/)
  if (doubleQuoted) return doubleQuoted[1]

  const templateLiteral = argumentExpression.match(/^`([^`$\\]*)`$/)
  if (templateLiteral) return templateLiteral[1]

  return null
}

export function parseRuntimeImportSpecifiers(content: string): RuntimeImportParseResult {
  const specifiers: ImportSpecifierEntry[] = []
  const unverifiable: ImportSpecifierEntry[] = []

  for (const match of content.matchAll(STATIC_IMPORT_FROM_RE)) {
    specifiers.push({ specifier: match[1], sourceExpression: match[1] })
  }

  for (const match of content.matchAll(EXPORT_FROM_RE)) {
    specifiers.push({ specifier: match[1], sourceExpression: match[1] })
  }

  for (const invocation of findDynamicImportInvocations(content)) {
    const specifier = parseExactDynamicImportSpecifier(invocation.argumentExpression)
    if (specifier == null) {
      unverifiable.push({
        specifier: invocation.sourceExpression,
        sourceExpression: invocation.sourceExpression,
      })
      continue
    }

    specifiers.push({ specifier, sourceExpression: invocation.sourceExpression })
  }

  return { specifiers, unverifiable }
}
