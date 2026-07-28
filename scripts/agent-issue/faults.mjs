const classificationLabels = Object.freeze({
  STATE_CONFLICT: 'STATE CONFLICT',
  BLOCKED_EXTERNAL: 'BLOCKED_EXTERNAL',
})

export class PreflightFault extends Error {
  constructor({ classification, code, order = 0, message }) {
    super(message)
    this.name = 'PreflightFault'
    this.classification = classification
    this.code = code
    this.order = order
  }

  render() {
    return `${classificationLabels[this.classification] ?? this.classification}: ${this.message}`
  }
}

export function renderPreflightFaults(faults = []) {
  return [...faults]
    .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
    .map((fault) => fault.render())
}
