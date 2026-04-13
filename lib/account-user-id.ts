const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

export function normalizeUserId(value: string): string {
  return value.trim().toLowerCase();
}

export function isUserIdValid(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}

export function validateUserId(value: string): string | null {
  const normalized = normalizeUserId(value);
  if (!isUserIdValid(normalized)) {
    return "user-id: 3-32 символа, только a-z, 0-9, ., _, -, начало и конец: буква/цифра.";
  }

  return null;
}

export function parseUserIdCandidate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeUserId(value);
  if (!isUserIdValid(normalized)) {
    return null;
  }

  return normalized;
}

export function assertValidUserId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(
      "user-id: 3-32 символа, только a-z, 0-9, ., _, -, начало и конец: буква/цифра."
    );
  }

  const normalized = normalizeUserId(value);
  if (!isUserIdValid(normalized)) {
    throw new Error(
      "user-id: 3-32 символа, только a-z, 0-9, ., _, -, начало и конец: буква/цифра."
    );
  }

  return normalized;
}
