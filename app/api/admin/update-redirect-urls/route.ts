import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const currentUrl = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081';
    
    // Get all accounts that need onboarding URL updates
    const accounts = await sql`
      SELECT 
        dpa.id,
        dpa.user_id,
        dpa.stripe_connect_account_id,
        dpa.onboarding_completed,
        dpa.onboarding_url,
        u.clerk_id,
        u.first_name,
        u.last_name
      FROM driver_payout_accounts dpa
      JOIN users u ON dpa.user_id = u.id
      WHERE dpa.stripe_connect_account_id IS NOT NULL
        AND (dpa.onboarding_url LIKE '%loop.dev%' OR dpa.onboarding_completed = false)
    `;

    const results = [];

    for (const account of accounts) {
      try {
    const sql = getDatabase();
        // Get current Stripe account status
        const stripeAccount = await stripe.accounts.retrieve(account.stripe_connect_account_id);
        
        // Check if account actually needs onboarding
        const onboardingComplete = stripeAccount.details_submitted && 
                                  stripeAccount.charges_enabled && 
                                  stripeAccount.payouts_enabled;

        let newOnboardingUrl = null;
        
        if (!onboardingComplete) {
          // Create new account link with correct URLs
          const accountLink = await stripe.accountLinks.create({
            account: account.stripe_connect_account_id,
            refresh_url: `${currentUrl}/(api)/payout/connect-refresh`,
            return_url: `${currentUrl}/(api)/payout/connect-return`,
            type: 'account_onboarding',
          });
          
          newOnboardingUrl = accountLink.url;
        }

        // Update database with new URL and current status
        await sql`
          UPDATE driver_payout_accounts
          SET 
            onboarding_url = ${newOnboardingUrl},
            onboarding_completed = ${onboardingComplete},
            account_status = ${stripeAccount.charges_enabled ? 'active' : 'pending'},
            details_submitted = ${stripeAccount.details_submitted},
            charges_enabled = ${stripeAccount.charges_enabled},
            payouts_enabled = ${stripeAccount.payouts_enabled},
            updated_at = NOW()
          WHERE id = ${account.id}
        `;

        results.push({
          user_name: `${account.first_name} ${account.last_name}`,
          stripe_account_id: account.stripe_connect_account_id,
          onboarding_complete: onboardingComplete,
          old_url_had_loop_dev: account.onboarding_url?.includes('loop.dev') || false,
          new_onboarding_url: newOnboardingUrl ? 'Updated' : 'Not needed (complete)',
          updated: true
        });

        console.log(`✅ Updated URLs for ${account.first_name} ${account.last_name}`);

      } catch (error) {
        console.error(`❌ Failed to update ${account.first_name} ${account.last_name}:`, error);
        results.push({
          user_name: `${account.first_name} ${account.last_name}`,
          stripe_account_id: account.stripe_connect_account_id,
          error: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error',
          updated: false
        });
      }
    }

    return Response.json({
      success: true,
      message: `Updated redirect URLs for ${accounts.length} accounts`,
      current_base_url: currentUrl,
      accounts_processed: accounts.length,
      successful_updates: results.filter(r => r.updated).length,
      failed_updates: results.filter(r => !r.updated).length,
      results: results
    });

  } catch (error) {
    console.error('Update redirect URLs error:', error);
    return Response.json({ 
      error: 'Failed to update redirect URLs',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}