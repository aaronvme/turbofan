// JSON.stringify is typed as returning string, but returns undefined for some inputs.
const stringify: (value: unknown) => string | undefined = JSON.stringify;

/** Short text for a value of unknown type, for validator messages. */
export function describeValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
    case 'symbol':
      return String(value);
    case 'function':
      return 'function';
    default:
      return value === null ? 'null' : (stringify(value) ?? 'object');
  }
}
