import {
  type Locale,
  type TranslationKey,
  translate,
} from "./i18n.ts";

export const API_ERROR_CODES = {
  UNAUTHORIZED: "unauthorized",
  INVALID_INPUT: "invalid_input",
  INVALID_CREDENTIALS: "invalid_credentials",
  EMAIL_NOT_VERIFIED: "email_not_verified",
  RATE_LIMITED: "rate_limited",
  USER_ID_TAKEN: "user_id_taken",
  EMAIL_TAKEN: "email_taken",
  MAIL_DELIVERY_FAILED: "mail_delivery_failed",
  ACCOUNT_LOAD_FAILED: "account_load_failed",
  ACCOUNT_UPDATE_FAILED: "account_update_failed",
  TOKEN_INVALID: "token_invalid",
  INTERNAL_ERROR: "internal_error",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

const ERROR_TRANSLATION_KEYS: Record<ApiErrorCode, TranslationKey> = {
  unauthorized: "error.unauthorized",
  invalid_input: "error.invalidInput",
  invalid_credentials: "error.invalidCredentials",
  email_not_verified: "error.emailNotVerified",
  rate_limited: "error.rateLimited",
  user_id_taken: "error.userIdTaken",
  email_taken: "error.emailTaken",
  mail_delivery_failed: "error.mailDelivery",
  account_load_failed: "error.accountLoad",
  account_update_failed: "error.accountUpdate",
  token_invalid: "error.tokenInvalid",
  internal_error: "common.unexpectedError",
};

export type ApiErrorPayload = {
  code?: string;
  error?: string;
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    Object.values(API_ERROR_CODES).includes(value as ApiErrorCode)
  );
}

export function localizeApiError(
  locale: Locale,
  payload: ApiErrorPayload | null | undefined,
  fallbackKey: TranslationKey = "common.unexpectedError"
): string {
  if (isApiErrorCode(payload?.code)) {
    return translate(locale, ERROR_TRANSLATION_KEYS[payload.code]);
  }

  return translate(locale, fallbackKey);
}
