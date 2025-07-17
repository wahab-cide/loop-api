import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { clerkId } = await request.json();

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user info from database
    const [user] = await sql`
      SELECT id, clerk_id, first_name, last_name, email, verification_status, is_driver
      FROM users 
      WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.is_driver) {
      return Response.json({ error: 'User must be a driver to create payout account' }, { status: 400 });
    }

    if (user.verification_status !== 'verified') {
      return Response.json({ 
        error: 'Driver must complete identity verification before setting up payouts',
        verification_required: true
      }, { status: 400 });
    }

    // Check if user already has a Connect account
    const [existingAccount] = await sql`
      SELECT stripe_connect_account_id, account_status, onboarding_completed, onboarding_url
      FROM driver_payout_accounts
      WHERE user_id = ${user.id}
    `;

    if (existingAccount) {
      // If account exists and onboarding is not complete, return existing onboarding URL
      if (!existingAccount.onboarding_completed && existingAccount.onboarding_url) {
        return Response.json({
          success: true,
          account_exists: true,
          onboarding_url: existingAccount.onboarding_url,
          account_status: existingAccount.account_status
        });
      }

      // If account is complete, return success
      if (existingAccount.onboarding_completed) {
        return Response.json({
          success: true,
          account_exists: true,
          account_complete: true,
          account_status: existingAccount.account_status
        });
      }
    }

    // Create new Stripe Connect Express account
    const connectAccount = await stripe.accounts.create({
      type: 'express',
      country: 'US', // TODO: Make this configurable based on user location
      email: user.email,
      business_type: 'individual',
      individual: {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        payouts: {
          schedule: {
            interval: 'manual', // Start with manual payouts
          },
        },
      },
      metadata: {
        user_id: user.id,
        clerk_id: clerkId,
      },
    });

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: connectAccount.id,
      refresh_url: `${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/payout/connect-refresh`,
      return_url: `${process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8081'}/(api)/payout/connect-return`,
      type: 'account_onboarding',
    });

    // Store account info in database
    if (existingAccount) {
      // Update existing record
      await sql`
        UPDATE driver_payout_accounts
        SET 
          stripe_connect_account_id = ${connectAccount.id},
          account_status = 'pending',
          onboarding_url = ${accountLink.url},
          onboarding_completed = FALSE,
          details_submitted = FALSE,
          charges_enabled = FALSE,
          payouts_enabled = FALSE,
          updated_at = NOW()
        WHERE user_id = ${user.id}
      `;
    } else {
      // Create new record
      await sql`
        INSERT INTO driver_payout_accounts (
          user_id,
          stripe_connect_account_id,
          account_status,
          onboarding_url,
          country,
          default_currency,
          business_type
        ) VALUES (
          ${user.id},
          ${connectAccount.id},
          'pending',
          ${accountLink.url},
          'US',
          'USD',
          'individual'
        )
      `;
    }

    return Response.json({
      success: true,
      onboarding_url: accountLink.url,
      account_id: connectAccount.id,
      message: 'Connect account created successfully'
    });

  } catch (error) {
    console.error('Connect account creation error:', error);
    return Response.json({ 
      error: 'Failed to create Connect account',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const { searchParams } = new URL(request.url);
    const clerkId = searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user and account info
    const [result] = await sql`
      SELECT 
        u.id as user_id,
        u.verification_status,
        u.is_driver,
        dpa.stripe_connect_account_id,
        dpa.account_status,
        dpa.onboarding_completed,
        dpa.onboarding_url,
        dpa.payouts_enabled,
        dpa.charges_enabled,
        dpa.details_submitted,
        dpa.bank_name,
        dpa.last_four_digits,
        dpa.requirements_due,
        dpa.stripe_dashboard_url
      FROM users u
      LEFT JOIN driver_payout_accounts dpa ON u.id = dpa.user_id
      WHERE u.clerk_id = ${clerkId}
    `;

    if (!result) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!result.is_driver) {
      return Response.json({ error: 'User is not a driver' }, { status: 400 });
    }

    // If no Connect account exists
    if (!result.stripe_connect_account_id) {
      return Response.json({
        success: true,
        account_exists: false,
        verification_status: result.verification_status,
        can_create_account: result.verification_status === 'verified'
      });
    }

    // Get fresh account data from Stripe
    try {
    const sql = getDatabase();
      const stripeAccount = await stripe.accounts.retrieve(result.stripe_connect_account_id);
      
      // Update our database with latest info
      await sql`
        UPDATE driver_payout_accounts
        SET 
          account_status = ${stripeAccount.charges_enabled ? 'active' : 'pending'},
          charges_enabled = ${stripeAccount.charges_enabled},
          payouts_enabled = ${stripeAccount.payouts_enabled},
          details_submitted = ${stripeAccount.details_submitted},
          requirements_due = ${stripeAccount.requirements?.currently_due || []},
          capabilities_enabled = ${Object.keys(stripeAccount.capabilities || {})},
          updated_at = NOW()
        WHERE user_id = ${result.user_id}
      `;

      return Response.json({
        success: true,
        account_exists: true,
        account: {
          id: stripeAccount.id,
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          requirements_due: stripeAccount.requirements?.currently_due || [],
          onboarding_completed: result.onboarding_completed,
          bank_account_connected: result.bank_name ? true : false,
          bank_name: result.bank_name,
          last_four_digits: result.last_four_digits,
        }
      });

    } catch (stripeError) {
      console.error('Error fetching Stripe account:', stripeError);
      
      // Return database info if Stripe call fails
      return Response.json({
        success: true,
        account_exists: true,
        account: {
          id: result.stripe_connect_account_id,
          charges_enabled: result.charges_enabled,
          payouts_enabled: result.payouts_enabled,
          details_submitted: result.details_submitted,
          onboarding_completed: result.onboarding_completed,
          bank_account_connected: result.bank_name ? true : false,
          bank_name: result.bank_name,
          last_four_digits: result.last_four_digits,
          stripe_error: true
        }
      });
    }

  } catch (error) {
    console.error('Get Connect account error:', error);
    return Response.json({ 
      error: 'Failed to get Connect account info',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}