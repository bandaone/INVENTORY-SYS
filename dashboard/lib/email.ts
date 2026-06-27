import { Resend } from 'resend';

// Initialize the Resend SDK. It automatically picks up process.env.RESEND_API_KEY
const resend = new Resend(process.env.RESEND_API_KEY);

// Use onboarding@resend.dev for testing if you haven't verified a domain yet
const FROM_EMAIL = process.env.NEXT_PUBLIC_FROM_EMAIL || 'onboarding@resend.dev';

export async function sendWelcomeEmail(to: string, ownerName: string) {
  try {
    const data = await resend.emails.send({
      from: `Retail OS <${FROM_EMAIL}>`,
      to,
      subject: 'Welcome to Retail OS! 🚀',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
          <h2 style="color: #10b981;">Welcome to Retail OS, ${ownerName}!</h2>
          <p>Your 5-day free trial has officially started. We are thrilled to have you on board.</p>
          <p>Your next step is to log into your dashboard and complete the <strong>Setup Wizard</strong> to configure your store.</p>
          <div style="margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/setup" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Setup Wizard</a>
          </div>
          <p>If you have any questions, just reply to this email!</p>
          <hr style="border: 1px solid #e5e7eb; margin-top: 40px;" />
          <p style="font-size: 12px; color: #6b7280;">Retail OS Zambia &copy; ${new Date().getFullYear()}</p>
        </div>
      `
    });
    return { success: true, data };
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    return { success: false, error };
  }
}

export async function sendTrialReminderEmail(to: string, ownerName: string, daysLeft: number) {
  try {
    const data = await resend.emails.send({
      from: `Retail OS Billing <${FROM_EMAIL}>`,
      to,
      subject: `Action Required: ${daysLeft} Days Left in Trial ⏰`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
          <h2 style="color: #f59e0b;">Your free trial ends in ${daysLeft} days!</h2>
          <p>Hi ${ownerName},</p>
          <p>We hope you are enjoying your new Point of Sale system. Your trial expires soon. To avoid any interruption in your store's operations, please activate your subscription from your dashboard.</p>
          <div style="margin: 30px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/superadmin/billing" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Activate My Account</a>
          </div>
          <p>Need more time or help setting up? Let us know.</p>
        </div>
      `
    });
    return { success: true, data };
  } catch (error) {
    console.error('Failed to send reminder email:', error);
    return { success: false, error };
  }
}
