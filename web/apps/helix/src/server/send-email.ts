import 'server-only';

import type React from 'react';

import { logger } from '@helix/logger';
import { render } from '@react-email/components';
import nodemailer from 'nodemailer';

import { env } from '@/lib/env';

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_SMTPS_PORT = 465;

const resolveSmtpConfig = (
  rawServer: string,
): {
  host: string;
  port: number;
  requireTLS: boolean;
  secure: boolean;
} => {
  const normalizedServer = rawServer.trim();
  if (normalizedServer === '') {
    throw new Error('SMTP_SERVER is required.');
  }

  if (!normalizedServer.includes('://')) {
    return {
      host: normalizedServer,
      port: DEFAULT_SMTP_PORT,
      requireTLS: true,
      secure: false,
    };
  }

  const parsedServer = new URL(normalizedServer);
  if (parsedServer.hostname.trim() === '') {
    throw new Error('SMTP_SERVER must include a hostname.');
  }

  if (parsedServer.protocol !== 'smtp:' && parsedServer.protocol !== 'smtps:') {
    throw new Error('SMTP_SERVER must use smtp:// or smtps:// when a protocol is provided.');
  }

  const secure = parsedServer.protocol === 'smtps:';
  const defaultPort = secure ? DEFAULT_SMTPS_PORT : DEFAULT_SMTP_PORT;
  const port = parsedServer.port === '' ? defaultPort : Number(parsedServer.port);

  return {
    host: parsedServer.hostname,
    port,
    requireTLS: !secure && port === DEFAULT_SMTP_PORT,
    secure,
  };
};

export const sendEmail = async (to: string[], subject: string, emailBody: React.ReactElement) => {
  const emailHtml = await render(emailBody);
  const emailText = await render(emailBody, { plainText: true });
  return sendRawEmail({ html: emailHtml, subject, text: emailText, to });
};

export const sendRawEmail = async ({
  to,
  subject,
  html,
  text,
}: {
  html?: string;
  subject: string;
  text?: string;
  to: string[];
}) => {
  if (env.EMAIL_LOG_CONTENT === 'true') {
    logger.info('[send-email] email content', { to, subject, text, html });
  }
  if (env.SMTP_SERVER === undefined || env.SMTP_SERVER.trim() === '') {
    logger.info('[send-email] SMTP not configured; email not delivered', { to, subject });
    return { messageId: 'dev-console' };
  }
  const smtpConfig = resolveSmtpConfig(env.SMTP_SERVER);
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    requireTLS: smtpConfig.requireTLS,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });
  const response = await transporter.sendMail({
    from: env.SMTP_SENDER,
    to,
    subject,
    html,
    text,
  });
  const { messageId } = response;
  if (messageId === '') {
    throw new Error('SMTP transport did not return a message id');
  }
  return { messageId };
};
