import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { type Locale, normalizeLocale } from "@/lib/i18n";

export class AuthEmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthEmailDeliveryError";
  }
}

let cachedTransporter: Transporter | null = null;

function parseSmtpPort(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 587;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1 || normalized > 65535) {
    return 587;
  }

  return normalized;
}

function parseSmtpSecure(value: string | undefined, port: number): boolean {
  if (typeof value !== "string") {
    return port === 465;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return port === 465;
}

function getAppBaseUrl(): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  throw new AuthEmailDeliveryError("APP_BASE_URL не задан. Письмо отправить нельзя.");
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AuthEmailDeliveryError(`${name} не задан. Письмо отправить нельзя.`);
  }

  return value;
}

function getTransporter(): { transporter: Transporter; from: string } {
  if (cachedTransporter) {
    return {
      transporter: cachedTransporter,
      from: getRequiredEnv("SMTP_FROM"),
    };
  }

  const host = getRequiredEnv("SMTP_HOST");
  const user = getRequiredEnv("SMTP_USER");
  const pass = getRequiredEnv("SMTP_PASS");
  const port = parseSmtpPort(process.env.SMTP_PORT);
  const secure = parseSmtpSecure(process.env.SMTP_SECURE, port);

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });

  return {
    transporter: cachedTransporter,
    from: getRequiredEnv("SMTP_FROM"),
  };
}

async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const { transporter, from } = getTransporter();

  try {
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } catch (error) {
    throw new AuthEmailDeliveryError(
      error instanceof Error ? error.message : "Не удалось отправить письмо."
    );
  }
}

function buildVerificationLink(token: string): string {
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

function buildResetLink(token: string): string {
  const baseUrl = getAppBaseUrl();
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendEmailVerificationMail(input: {
  to: string;
  token: string;
  expiresAt: Date;
  locale?: Locale;
}): Promise<void> {
  const link = buildVerificationLink(input.token);
  const locale = normalizeLocale(input.locale);
  const isEnglish = locale === "en";
  const expiresAtText = input.expiresAt.toLocaleString(isEnglish ? "en-GB" : "ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  await sendAuthEmail({
    to: input.to,
    subject: isEnglish ? "Confirm your Item Key email" : "Подтверждение email в Item Key",
    text: isEnglish
      ? [
          "Confirm your email to sign in to Item Key.",
          "",
          `Link: ${link}`,
          `Valid until: ${expiresAtText}`,
        ].join("\n")
      : [
          "Подтверди email для входа в Item Key.",
          "",
          `Ссылка: ${link}`,
          `Действует до: ${expiresAtText}`,
        ].join("\n"),
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#1a1a1a">
        <p>${isEnglish ? "Confirm your email to sign in to" : "Подтверди email для входа в"} <strong>Item Key</strong>.</p>
        <p><a href="${link}">${isEnglish ? "Confirm email" : "Подтвердить email"}</a></p>
        <p style="font-size:13px;color:#555">${isEnglish ? "Valid until" : "Ссылка действует до"}: ${expiresAtText}</p>
      </div>
    `,
  });
}

export async function sendPasswordResetMail(input: {
  to: string;
  token: string;
  expiresAt: Date;
  locale?: Locale;
}): Promise<void> {
  const link = buildResetLink(input.token);
  const locale = normalizeLocale(input.locale);
  const isEnglish = locale === "en";
  const expiresAtText = input.expiresAt.toLocaleString(isEnglish ? "en-GB" : "ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  await sendAuthEmail({
    to: input.to,
    subject: isEnglish ? "Reset your Item Key password" : "Сброс пароля в Item Key",
    text: isEnglish
      ? [
          "We received a request to reset your Item Key password.",
          "",
          `Link: ${link}`,
          `Valid until: ${expiresAtText}`,
          "",
          "If this was not you, ignore this email.",
        ].join("\n")
      : [
          "Получен запрос на сброс пароля в Item Key.",
          "",
          `Ссылка: ${link}`,
          `Действует до: ${expiresAtText}`,
          "",
          "Если это были не вы, просто проигнорируйте это письмо.",
        ].join("\n"),
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#1a1a1a">
        <p>${isEnglish ? "We received a password reset request for" : "Получен запрос на сброс пароля в"} <strong>Item Key</strong>.</p>
        <p><a href="${link}">${isEnglish ? "Reset password" : "Сбросить пароль"}</a></p>
        <p style="font-size:13px;color:#555">${isEnglish ? "Valid until" : "Ссылка действует до"}: ${expiresAtText}</p>
        <p style="font-size:13px;color:#555">${isEnglish ? "If this was not you, ignore this email." : "Если это были не вы, просто проигнорируйте это письмо."}</p>
      </div>
    `,
  });
}
