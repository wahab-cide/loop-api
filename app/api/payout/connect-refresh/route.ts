import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account');

    if (!accountId) {
      return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=error&message=missing_account_id`);
    }

    // Find user account in database
    const [account] = await sql`
      SELECT user_id, stripe_connect_account_id
      FROM driver_payout_accounts
      WHERE stripe_connect_account_id = ${accountId}
    `;

    if (!account) {
      return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=error&message=account_not_found`);
    }

    // Create new account link for continued onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/payout/connect-refresh`,
      return_url: `${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/payout/connect-return`,
      type: 'account_onboarding',
    });

    // Update the onboarding URL in database
    await sql`
      UPDATE driver_payout_accounts
      SET 
        onboarding_url = ${accountLink.url},
        updated_at = NOW()
      WHERE user_id = ${account.user_id}
    `;

    // Redirect to new onboarding URL
    return Response.redirect(accountLink.url);

  } catch (error) {
    console.error('Connect refresh error:', error);
    return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=error&message=refresh_failed`);
  }
}