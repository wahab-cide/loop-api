import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { searchParams } = new URL(request.url);
    const clerkId = searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    // Get user and current database status
    const [result] = await sql`
      SELECT 
        u.id,
        u.clerk_id,
        dpa.stripe_connect_account_id,
        dpa.account_status,
        dpa.onboarding_completed,
        dpa.payouts_enabled,
        dpa.bank_account_id,
        dpa.bank_name,
        dpa.details_submitted,
        dpa.charges_enabled
      FROM users u
      LEFT JOIN driver_payout_accounts dpa ON u.id = dpa.user_id
      WHERE u.clerk_id = ${clerkId}
    `;

    if (!result || !result.stripe_connect_account_id) {
      return Response.json({ error: 'No Stripe Connect account found' }, { status: 404 });
    }

    // Get current Stripe account status
    const stripeAccount = await stripe.accounts.retrieve(result.stripe_connect_account_id);
    
    // Get external accounts (bank accounts)
    const externalAccounts = await stripe.accounts.listExternalAccounts(
      result.stripe_connect_account_id,
      { object: 'bank_account', limit: 10 }
    );

    // Determine if onboarding is actually complete
    const shouldBeComplete = stripeAccount.details_submitted && 
                             stripeAccount.charges_enabled && 
                             stripeAccount.payouts_enabled;

    return Response.json({
      user_id: result.id,
      stripe_connect_account_id: result.stripe_connect_account_id,
      database_status: {
        account_status: result.account_status,
        onboarding_completed: result.onboarding_completed,
        payouts_enabled: result.payouts_enabled,
        bank_account_id: result.bank_account_id,
        bank_name: result.bank_name,
        details_submitted: result.details_submitted,
        charges_enabled: result.charges_enabled
      },
      stripe_status: {
        details_submitted: stripeAccount.details_submitted,
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
        requirements_currently_due: stripeAccount.requirements?.currently_due || [],
        requirements_past_due: stripeAccount.requirements?.past_due || [],
        external_accounts_count: externalAccounts.data.length,
        capabilities: stripeAccount.capabilities
      },
      should_be_complete: shouldBeComplete,
      mismatch_detected: result.onboarding_completed !== shouldBeComplete,
      bank_accounts: externalAccounts.data.map(account => ({
        id: account.id,
        bank_name: (account as Stripe.BankAccount).bank_name,
        last4: (account as Stripe.BankAccount).last4,
        account_type: (account as Stripe.BankAccount).account_type
      }))
    });

  } catch (error) {
    console.error('Debug check error:', error);
    return Response.json({ 
      error: 'Failed to check status',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}