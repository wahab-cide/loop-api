import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account');

    if (!accountId) {
      // Redirect to app with error
      return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=error&message=missing_account_id`);
    }

    // Get account info from Stripe
    const stripeAccount = await stripe.accounts.retrieve(accountId);
    
    // Find user in database
    const [account] = await sql`
      SELECT user_id, stripe_connect_account_id
      FROM driver_payout_accounts
      WHERE stripe_connect_account_id = ${accountId}
    `;

    if (!account) {
      return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=error&message=account_not_found`);
    }

    // Update account status in database
    const onboardingCompleted = stripeAccount.details_submitted && 
                               stripeAccount.charges_enabled && 
                               stripeAccount.payouts_enabled;

    await sql`
      UPDATE driver_payout_accounts
      SET 
        account_status = ${stripeAccount.charges_enabled ? 'active' : 'pending'},
        onboarding_completed = ${onboardingCompleted},
        details_submitted = ${stripeAccount.details_submitted},
        charges_enabled = ${stripeAccount.charges_enabled},
        payouts_enabled = ${stripeAccount.payouts_enabled},
        requirements_due = ${JSON.stringify(stripeAccount.requirements?.currently_due || [])},
        capabilities_enabled = ${JSON.stringify(Object.keys(stripeAccount.capabilities || {}))},
        onboarding_url = NULL, -- Clear the onboarding URL
        updated_at = NOW()
      WHERE user_id = ${account.user_id}
    `;

    // Get external accounts (bank accounts)
    const externalAccounts = await stripe.accounts.listExternalAccounts(accountId, {
      object: 'bank_account',
      limit: 1,
    });

    if (externalAccounts.data.length > 0) {
      const bankAccount = externalAccounts.data[0] as Stripe.BankAccount;
      
      // Update bank account info
      await sql`
        UPDATE driver_payout_accounts
        SET 
          bank_account_id = ${bankAccount.id},
          bank_name = ${bankAccount.bank_name || 'Unknown Bank'},
          account_type = ${bankAccount.account_type || 'checking'},
          last_four_digits = ${bankAccount.last4},
          routing_number_last_four = ${bankAccount.routing_number?.slice(-4) || null},
          updated_at = NOW()
        WHERE user_id = ${account.user_id}
      `;
    }

    // Initialize default payout settings if not exists
    await sql`
      INSERT INTO driver_payout_settings (user_id)
      VALUES (${account.user_id})
      ON CONFLICT (user_id) DO NOTHING
    `;

    // Calculate and update earnings summary
    await sql`SELECT recalculate_driver_earnings(${account.user_id}::UUID)`;

    if (onboardingCompleted) {
      // Redirect to app with success
      return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=success&message=account_complete`);
    } else {
      // Redirect with pending status
      return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=pending&message=verification_needed`);
    }

  } catch (error) {
    console.error('Connect return error:', error);
    return Response.redirect(`${process.env.EXPO_PUBLIC_APP_URL || 'exp://localhost:8081'}/?payout_setup=error&message=processing_failed`);
  }
}