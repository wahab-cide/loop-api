import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { clerkId } = await request.json();

    if (!clerkId) {
      return Response.json({ error: 'clerkId is required' }, { status: 400 });
    }

    // Get user and connect account
    const [result] = await sql`
      SELECT 
        u.id,
        dpa.stripe_connect_account_id
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
      { object: 'bank_account', limit: 1 }
    );

    // Update account status
    const accountStatus = stripeAccount.charges_enabled ? 'active' : 'pending';
    const onboardingCompleted = stripeAccount.details_submitted && 
                               stripeAccount.charges_enabled && 
                               stripeAccount.payouts_enabled;

    let bankAccount = null;
    if (externalAccounts.data.length > 0) {
      bankAccount = externalAccounts.data[0] as Stripe.BankAccount;
    }

    // Update database
    const updateResult = await sql`
      UPDATE driver_payout_accounts
      SET 
        account_status = ${accountStatus},
        onboarding_completed = ${onboardingCompleted},
        details_submitted = ${stripeAccount.details_submitted},
        charges_enabled = ${stripeAccount.charges_enabled},
        payouts_enabled = ${stripeAccount.payouts_enabled},
        requirements_due = ${stripeAccount.requirements?.currently_due || []},
        capabilities_enabled = ${Object.keys(stripeAccount.capabilities || {})},
        ${bankAccount ? sql`
          bank_account_id = ${bankAccount.id},
          bank_name = ${bankAccount.bank_name || 'Unknown Bank'},
          account_type = ${bankAccount.account_type || 'checking'},
          last_four_digits = ${bankAccount.last4},
          routing_number_last_four = ${bankAccount.routing_number?.slice(-4) || null},
        ` : sql``}
        updated_at = NOW()
      WHERE stripe_connect_account_id = ${result.stripe_connect_account_id}
      RETURNING *
    `;

    return Response.json({
      success: true,
      message: 'Payout account status synced successfully',
      updated_account: updateResult[0],
      stripe_data: {
        details_submitted: stripeAccount.details_submitted,
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
        onboarding_complete: onboardingCompleted
      },
      bank_account: bankAccount ? {
        id: bankAccount.id,
        bank_name: bankAccount.bank_name,
        last4: bankAccount.last4,
        account_type: bankAccount.account_type
      } : null
    });

  } catch (error) {
    console.error('Sync error:', error);
    return Response.json({ 
      error: 'Failed to sync status',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}