export type JsonObject = Record<string, unknown>;

export async function readJsonObject(
  request: Request
): Promise<JsonObject | null> {
  try {
    const body: unknown = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return null;
    }

    return body as JsonObject;
  } catch {
    return null;
  }
}

export function hasOnlyAllowedFields(
  body: JsonObject,
  allowedFields: readonly string[]
): boolean {
  const allowed = new Set(allowedFields);
  return Object.keys(body).every((field) => allowed.has(field));
}

export function isValidEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

export function isValidFirestoreDocumentId(value: string): boolean {
  return (
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 1500 &&
    !value.includes("/") &&
    value !== "." &&
    value !== ".." &&
    !/^__.*__$/.test(value)
  );
}
