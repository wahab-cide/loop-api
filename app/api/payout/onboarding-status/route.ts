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

    // Get user and payout account
    const [result] = await sql`
      SELECT 
        u.id,
        dpa.stripe_connect_account_id,
        dpa.account_status,
        dpa.onboarding_completed,
        dpa.onboarding_url,
        dpa.bank_account_id,
        dpa.bank_name,
        dpa.payouts_enabled
      FROM users u
      LEFT JOIN driver_payout_accounts dpa ON u.id = dpa.user_id
      WHERE u.clerk_id = ${clerkId}
    `;

    if (!result) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!result.stripe_connect_account_id) {
      return Response.json({ 
        error: 'No Stripe Connect account found',
        status: 'no_account'
      }, { status: 404 });
    }

    // Get latest status from Stripe
    let stripeAccount;
    try {
    const sql = getDatabase();
      stripeAccount = await stripe.accounts.retrieve(result.stripe_connect_account_id);
    } catch (stripeError) {
      console.error('Failed to retrieve Stripe account:', stripeError);
      return Response.json({ 
        error: 'Failed to retrieve Stripe account status',
        details: stripeError instanceof Error ? stripeError.message : 'Unknown error'
      }, { status: 500 });
    }

    // Check if onboarding is complete
    const onboardingComplete = stripeAccount.details_submitted && 
                               stripeAccount.charges_enabled && 
                               stripeAccount.payouts_enabled;

    // Get onboarding URL if needed
    let onboardingUrl = result.onboarding_url;
    if (!onboardingComplete) {
      try {
    const sql = getDatabase();
        const accountLink = await stripe.accountLinks.create({
          account: result.stripe_connect_account_id,
          refresh_url: `${process.env.EXPO_PUBLIC_SERVER_URL}/(api)/payout/connect-account`,
          return_url: `${process.env.EXPO_PUBLIC_SERVER_URL}/(api)/payout/connect-account`,
          type: 'account_onboarding',
        });
        onboardingUrl = accountLink.url;
      } catch (linkError) {
        console.error('Failed to create account link:', linkError);
      }
    }

    // Update database if status changed
    if (result.onboarding_completed !== onboardingComplete || 
        result.account_status !== (stripeAccount.charges_enabled ? 'active' : 'pending')) {
      
      await sql`
        UPDATE driver_payout_accounts
        SET 
          account_status = ${stripeAccount.charges_enabled ? 'active' : 'pending'},
          onboarding_completed = ${onboardingComplete},
          details_submitted = ${stripeAccount.details_submitted},
          charges_enabled = ${stripeAccount.charges_enabled},
          payouts_enabled = ${stripeAccount.payouts_enabled},
          onboarding_url = ${onboardingUrl},
          updated_at = NOW()
        WHERE stripe_connect_account_id = ${result.stripe_connect_account_id}
      `;
    }

    return Response.json({
      success: true,
      account_id: result.stripe_connect_account_id,
      database_status: {
        account_status: result.account_status,
        onboarding_completed: result.onboarding_completed,
        bank_connected: !!result.bank_account_id,
        bank_name: result.bank_name,
        payouts_enabled: result.payouts_enabled
      },
      stripe_status: {
        details_submitted: stripeAccount.details_submitted,
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
        onboarding_complete: onboardingComplete,
        requirements_due: stripeAccount.requirements?.currently_due || [],
        requirements_past_due: stripeAccount.requirements?.past_due || []
      },
      onboarding_url: onboardingUrl,
      needs_onboarding: !onboardingComplete
    });

  } catch (error) {
    console.error('Onboarding status check error:', error);
    return Response.json({ 
      error: 'Failed to check onboarding status',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}