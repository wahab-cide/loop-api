import { getDatabase } from '@/lib/database';


export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const { searchParams } = new URL(request.url);
    const clerkId = searchParams.get('clerkId');

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user info
    const [user] = await sql`
      SELECT id, clerk_id, is_driver, verification_status
      FROM users 
      WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.is_driver) {
      return Response.json({ error: 'User is not a driver' }, { status: 400 });
    }

    // Get or create earnings summary
    let [earnings] = await sql`
      SELECT * FROM driver_earnings_summary
      WHERE user_id = ${user.id}
    `;

    if (!earnings) {
      // Create initial earnings summary
      await sql`
        INSERT INTO driver_earnings_summary (user_id)
        VALUES (${user.id})
      `;

      // Calculate earnings
      await sql`SELECT recalculate_driver_earnings(${user.id}::UUID)`;

      // Fetch the newly created/calculated earnings
      [earnings] = await sql`
        SELECT * FROM driver_earnings_summary
        WHERE user_id = ${user.id}
      `;
    }

    // Check if earnings need updating (older than 5 minutes)
    const lastUpdate = new Date(earnings.last_calculation_at);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    if (lastUpdate < fiveMinutesAgo) {
      // Recalculate earnings
      await sql`SELECT recalculate_driver_earnings(${user.id}::UUID)`;
      
      // Fetch updated earnings
      [earnings] = await sql`
        SELECT * FROM driver_earnings_summary
        WHERE user_id = ${user.id}
      `;
    }

    // Get payout account status
    const [payoutAccount] = await sql`
      SELECT 
        account_status,
        payouts_enabled,
        onboarding_completed,
        bank_name,
        last_four_digits,
        bank_account_id,
        stripe_connect_account_id,
        details_submitted,
        charges_enabled
      FROM driver_payout_accounts
      WHERE user_id = ${user.id}
    `;

    // Get recent transactions
    const recentTransactions = await sql`
      SELECT 
        id,
        amount,
        net_amount,
        status,
        description,
        processed_at,
        expected_arrival_date,
        destination_bank_name,
        destination_last_four,
        created_at
      FROM payout_transactions
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    // Get payout settings
    const [payoutSettings] = await sql`
      SELECT 
        auto_payout_enabled,
        auto_payout_threshold,
        payout_schedule,
        notify_on_payout_complete
      FROM driver_payout_settings
      WHERE user_id = ${user.id}
    `;

    // Determine if user can withdraw
    const canWithdraw = user.verification_status === 'verified' && 
                       payoutAccount?.payouts_enabled === true &&
                       parseFloat(earnings.available_balance) >= 10.00; // Minimum $10

    return Response.json({
      success: true,
      earnings: {
        total_earned: parseFloat(earnings.total_earned),
        total_withdrawn: parseFloat(earnings.total_withdrawn),
        pending_withdrawal: parseFloat(earnings.pending_withdrawal),
        available_balance: parseFloat(earnings.available_balance),
        current_month_earnings: parseFloat(earnings.current_month_earnings),
        last_month_earnings: parseFloat(earnings.last_month_earnings),
        current_week_earnings: parseFloat(earnings.current_week_earnings),
        total_rides: earnings.total_rides,
        total_bookings: earnings.total_bookings,
        total_riders_served: earnings.total_riders_served,
        average_ride_earnings: parseFloat(earnings.average_ride_earnings || 0),
        highest_ride_earnings: parseFloat(earnings.highest_ride_earnings || 0),
        total_payouts: earnings.total_payouts,
        last_payout_amount: earnings.last_payout_amount ? parseFloat(earnings.last_payout_amount) : null,
        last_payout_at: earnings.last_payout_at,
        last_earnings_update: earnings.last_earnings_update,
      },
      payout_account: payoutAccount ? {
        account_status: payoutAccount.account_status,
        payouts_enabled: payoutAccount.payouts_enabled,
        onboarding_completed: payoutAccount.onboarding_completed,
        bank_connected: !!(payoutAccount.bank_name || payoutAccount.bank_account_id),
        bank_name: payoutAccount.bank_name,
        last_four_digits: payoutAccount.last_four_digits,
        details_submitted: payoutAccount.details_submitted,
        charges_enabled: payoutAccount.charges_enabled,
      } : {
        account_status: false,
        payouts_enabled: false,
        onboarding_completed: false,
        bank_connected: false,
        bank_name: null,
        last_four_digits: null,
        details_submitted: false,
        charges_enabled: false,
      },
      payout_settings: payoutSettings ? {
        auto_payout_enabled: payoutSettings.auto_payout_enabled,
        auto_payout_threshold: parseFloat(payoutSettings.auto_payout_threshold),
        payout_schedule: payoutSettings.payout_schedule,
        notify_on_payout_complete: payoutSettings.notify_on_payout_complete,
      } : null,
      recent_transactions: recentTransactions.map(tx => ({
        id: tx.id,
        amount: parseFloat(tx.amount),
        net_amount: parseFloat(tx.net_amount),
        status: tx.status,
        description: tx.description,
        processed_at: tx.processed_at,
        expected_arrival_date: tx.expected_arrival_date,
        bank_name: tx.destination_bank_name,
        last_four: tx.destination_last_four,
        created_at: tx.created_at,
      })),
      verification_status: user.verification_status,
      can_withdraw: canWithdraw,
      minimum_withdrawal: 10.00,
    });

  } catch (error) {
    console.error('Get earnings error:', error);
    return Response.json({ 
      error: 'Failed to get earnings data',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { clerkId, recalculate } = await request.json();

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user info
    const [user] = await sql`
      SELECT id, is_driver
      FROM users 
      WHERE clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.is_driver) {
      return Response.json({ error: 'User is not a driver' }, { status: 400 });
    }

    if (recalculate) {
      // Force recalculation of earnings
      await sql`SELECT recalculate_driver_earnings(${user.id}::UUID)`;
    }

    return Response.json({
      success: true,
      message: 'Earnings updated successfully'
    });

  } catch (error) {
    console.error('Update earnings error:', error);
    return Response.json({ 
      error: 'Failed to update earnings',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}