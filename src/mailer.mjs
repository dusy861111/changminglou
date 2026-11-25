import nodemailer from 'nodemailer';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.mjs';

// 邮件发送：配了 SMTP_* 就走真邮件；没配就写到 data/mail.log（本地开发用）。
function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    from: process.env.MAIL_FROM || user
  };
}

export function mailerConfigured() {
  return Boolean(smtpConfig());
}

export async function sendVerificationEmail({ to, name, link }) {
  const subject = '长明楼 · 确认你的邮箱';
  const text = `${name}，你好：

点下面的链接确认邮箱，门就开了（24 小时内有效）：

${link}

如果不是你本人注册，忽略这封邮件即可。

长明楼
灯亮着，就说明还有人在。`;
  const html = `<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#2b2a27;background:#f6f1e7;border-radius:12px">
  <p style="font-size:20px;font-weight:700;margin:0 0 8px">长明楼</p>
  <p style="color:#857f73;margin:0 0 24px">灯亮着，就说明还有人在。</p>
  <p>${escapeHtml(name)}，你好：</p>
  <p>点下面的按钮确认邮箱，门就开了。链接 24 小时内有效。</p>
  <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#a33a2a;color:#fff;text-decoration:none;border-radius:8px">确认邮箱，进门</a></p>
  <p style="color:#857f73;font-size:13px;word-break:break-all">如果按钮点不开，复制这个链接到浏览器：<br>${escapeHtml(link)}</p>
  <p style="color:#857f73;font-size:13px">如果不是你本人注册，忽略这封邮件即可。</p>
</div>`;

  const cfg = smtpConfig();
  if (!cfg) {
    appendFileSync(
      join(DATA_DIR, 'mail.log'),
      `${new Date().toISOString()}\t${to}\t${link}\n`
    );
    console.log(`[mail:dev] ${to} -> ${link}`);
    return { delivered: false, link };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth
  });
  await transporter.sendMail({
    from: `长明楼 <${cfg.from}>`,
    to,
    subject,
    text,
    html
  });
  return { delivered: true, link };
}

function escapeHtml(value = '') {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c]
  );
}
