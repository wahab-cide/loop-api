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

    // Get user and payout account
    const [result] = await sql`
      SELECT 
        u.id as user_id,
        dpa.stripe_connect_account_id,
        dpa.account_status as current_status,
        dpa.onboarding_completed as current_onboarding,
        dpa.bank_name as current_bank_name,
        dpa.bank_account_id as current_bank_id
      FROM users u
      LEFT JOIN driver_payout_accounts dpa ON u.id = dpa.user_id
      WHERE u.clerk_id = ${clerkId}
    `;

    if (!result) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!result.stripe_connect_account_id) {
      return Response.json({ 
        success: false,
        error: 'No Stripe Connect account found',
        message: 'User has not set up a payout account yet',
        status_changed: {
          account_status: false,
          onboarding_completed: false,
          bank_connected: false
        }
      }, { status: 404 });
    }

    // Get latest account data from Stripe
    const stripeAccount = await stripe.accounts.retrieve(result.stripe_connect_account_id);
    
    // Get external accounts (bank accounts)
    const externalAccounts = await stripe.accounts.listExternalAccounts(
      result.stripe_connect_account_id,
      { object: 'bank_account', limit: 1 }
    );

    const primaryBankAccount = externalAccounts.data[0] as Stripe.BankAccount | undefined;

    // Determine if onboarding is complete
    const onboardingComplete = stripeAccount.details_submitted && 
                               stripeAccount.charges_enabled && 
                               stripeAccount.payouts_enabled;

    // Update database with latest info
    await sql`
      UPDATE driver_payout_accounts
      SET 
        account_status = ${stripeAccount.charges_enabled ? 'active' : 'pending'},
        onboarding_completed = ${onboardingComplete},
        details_submitted = ${stripeAccount.details_submitted},
        charges_enabled = ${stripeAccount.charges_enabled},
        payouts_enabled = ${stripeAccount.payouts_enabled},
        requirements_due = ${stripeAccount.requirements?.currently_due || []},
        capabilities_enabled = ${Object.keys(stripeAccount.capabilities || {})},
        bank_account_id = ${primaryBankAccount?.id || null},
        bank_name = ${primaryBankAccount?.bank_name || null},
        account_type = ${primaryBankAccount?.account_type || null},
        last_four_digits = ${primaryBankAccount?.last4 || null},
        routing_number_last_four = ${primaryBankAccount?.routing_number?.slice(-4) || null},
        updated_at = NOW()
      WHERE user_id = ${result.user_id}
    `;

    // Return current status
    const [updatedAccount] = await sql`
      SELECT 
        account_status,
        payouts_enabled,
        onboarding_completed,
        bank_name,
        last_four_digits,
        bank_account_id,
        details_submitted,
        charges_enabled,
        requirements_due
      FROM driver_payout_accounts
      WHERE user_id = ${result.user_id}
    `;

    return Response.json({
      success: true,
      message: 'Account status synced successfully',
      status_changed: {
        account_status: result.current_status !== updatedAccount.account_status,
        onboarding_completed: result.current_onboarding !== updatedAccount.onboarding_completed,
        bank_connected: (!result.current_bank_name && !!updatedAccount.bank_name) || 
                       (!result.current_bank_id && !!updatedAccount.bank_account_id)
      },
      account: {
        account_status: updatedAccount.account_status,
        payouts_enabled: updatedAccount.payouts_enabled,
        onboarding_completed: updatedAccount.onboarding_completed,
        bank_connected: !!(updatedAccount.bank_name || updatedAccount.bank_account_id),
        bank_name: updatedAccount.bank_name,
        last_four_digits: updatedAccount.last_four_digits,
        details_submitted: updatedAccount.details_submitted,
        charges_enabled: updatedAccount.charges_enabled,
        requirements_due: updatedAccount.requirements_due || []
      },
      stripe_account: {
        id: stripeAccount.id,
        details_submitted: stripeAccount.details_submitted,
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
        requirements_currently_due: stripeAccount.requirements?.currently_due || [],
        requirements_past_due: stripeAccount.requirements?.past_due || [],
        external_accounts_count: externalAccounts.data.length
      }
    });

  } catch (error) {
    console.error('Sync account status error:', error);
    return Response.json({ 
      error: 'Failed to sync account status',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}