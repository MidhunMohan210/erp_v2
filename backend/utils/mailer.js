import nodemailer from "nodemailer";

export function createMailerTransport() {
  if (
    !process.env.NODE_MAILER_EMAIL ||
    !process.env.NODE_MAILER_APP_PASSWORD
  ) {
    const error = new Error(
      "Mailer is not configured. Missing NODE_MAILER_EMAIL or NODE_MAILER_APP_PASSWORD",
    );
    error.statusCode = 500;
    throw error;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.NODE_MAILER_EMAIL,
      pass: process.env.NODE_MAILER_APP_PASSWORD,
    },
  });
}

export function getMailerFromAddress() {
  return process.env.NODE_MAILER_EMAIL;
}
