import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    // Get all payout accounts that have Stripe Connect accounts
    const accounts = await sql`
      SELECT 
        dpa.id,
        dpa.user_id,
        dpa.stripe_connect_account_id,
        dpa.account_status,
        dpa.onboarding_completed,
        dpa.payouts_enabled,
        u.clerk_id,
        u.first_name,
        u.last_name
      FROM driver_payout_accounts dpa
      JOIN users u ON dpa.user_id = u.id
      WHERE dpa.stripe_connect_account_id IS NOT NULL
    `;

    const results = [];

    for (const account of accounts) {
      try {
    const sql = getDatabase();
        console.log(`Syncing account ${account.stripe_connect_account_id} for user ${account.first_name} ${account.last_name}`);

        // Get current Stripe account status
        const stripeAccount = await stripe.accounts.retrieve(account.stripe_connect_account_id);
        
        // Get external accounts (bank accounts)
        const externalAccounts = await stripe.accounts.listExternalAccounts(
          account.stripe_connect_account_id,
          { object: 'bank_account', limit: 1 }
        );

        // Determine current status
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
          WHERE id = ${account.id}
          RETURNING *
        `;

        results.push({
          user_id: account.user_id,
          user_name: `${account.first_name} ${account.last_name}`,
          stripe_account_id: account.stripe_connect_account_id,
          was_completed: account.onboarding_completed,
          now_completed: onboardingCompleted,
          was_payouts_enabled: account.payouts_enabled,
          now_payouts_enabled: stripeAccount.payouts_enabled,
          bank_connected: !!bankAccount,
          bank_name: bankAccount?.bank_name || null,
          updated: true
        });

        console.log(`✅ Updated ${account.first_name} ${account.last_name}: onboarding ${onboardingCompleted ? 'complete' : 'incomplete'}, payouts ${stripeAccount.payouts_enabled ? 'enabled' : 'disabled'}`);

      } catch (error) {
        console.error(`❌ Failed to sync account ${account.stripe_connect_account_id}:`, error);
        results.push({
          user_id: account.user_id,
          user_name: `${account.first_name} ${account.last_name}`,
          stripe_account_id: account.stripe_connect_account_id,
          error: error instanceof Error ? error.message : 'Unknown error',
          updated: false
        });
      }
    }

    return Response.json({
      success: true,
      message: `Synced ${accounts.length} accounts`,
      accounts_processed: accounts.length,
      successful_updates: results.filter(r => r.updated).length,
      failed_updates: results.filter(r => !r.updated).length,
      results: results
    });

  } catch (error) {
    console.error('Bulk sync error:', error);
    return Response.json({ 
      error: 'Failed to sync accounts',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}