import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const { clerkId, amount, description } = await request.json();

    if (!clerkId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    if (!amount || amount <= 0) {
      return Response.json({ error: 'Valid withdrawal amount is required' }, { status: 400 });
    }

    // Minimum withdrawal check
    if (amount < 10.00) {
      return Response.json({ error: 'Minimum withdrawal amount is $10.00' }, { status: 400 });
    }

    // Get user and account info
    const [user] = await sql`
      SELECT 
        u.id,
        u.clerk_id,
        u.verification_status,
        u.is_driver,
        u.first_name,
        u.last_name
      FROM users u
      WHERE u.clerk_id = ${clerkId}
    `;

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.is_driver) {
      return Response.json({ error: 'User is not a driver' }, { status: 400 });
    }

    if (user.verification_status !== 'verified') {
      return Response.json({ 
        error: 'Driver must complete identity verification before withdrawing funds',
        verification_required: true
      }, { status: 400 });
    }

    // Get payout account
    const [payoutAccount] = await sql`
      SELECT 
        stripe_connect_account_id,
        account_status,
        payouts_enabled,
        onboarding_completed,
        bank_account_id,
        bank_name,
        last_four_digits
      FROM driver_payout_accounts
      WHERE user_id = ${user.id}
    `;

    if (!payoutAccount) {
      return Response.json({ 
        error: 'No payout account found. Please set up your bank account first.',
        setup_required: true
      }, { status: 400 });
    }

    if (!payoutAccount.payouts_enabled) {
      return Response.json({ 
        error: 'Payout account is not enabled. Please complete account verification.',
        verification_required: true
      }, { status: 400 });
    }

    // Get current earnings
    await sql`SELECT recalculate_driver_earnings(${user.id}::UUID)`;
    
    const [earnings] = await sql`
      SELECT available_balance, total_earned, total_withdrawn, pending_withdrawal
      FROM driver_earnings_summary
      WHERE user_id = ${user.id}
    `;

    if (!earnings) {
      return Response.json({ error: 'Earnings data not found' }, { status: 404 });
    }

    const availableBalance = parseFloat(earnings.available_balance);

    if (amount > availableBalance) {
      return Response.json({ 
        error: `Insufficient balance. Available: $${availableBalance.toFixed(2)}`,
        available_balance: availableBalance
      }, { status: 400 });
    }

    // Calculate fees (example: 2.9% + $0.30 platform fee)
    const platformFeePercentage = 0.029; // 2.9%
    const platformFeeFixed = 0.30;
    const platformFee = Math.round((amount * platformFeePercentage + platformFeeFixed) * 100) / 100;
    
    // Stripe Connect transfer fee (no additional fee for standard transfers)
    const stripeFee = 0;
    
    const netAmount = amount - platformFee - stripeFee;

    if (netAmount <= 0) {
      return Response.json({ 
        error: 'Amount too small after fees',
        platform_fee: platformFee,
        net_amount: netAmount
      }, { status: 400 });
    }

    // Create payout transaction record
    const [transaction] = await sql`
      INSERT INTO payout_transactions (
        user_id,
        amount,
        platform_fee,
        stripe_fee,
        description,
        destination_bank_name,
        destination_last_four,
        status
      ) VALUES (
        ${user.id},
        ${amount},
        ${platformFee},
        ${stripeFee},
        ${description || `Withdrawal by ${user.first_name} ${user.last_name}`},
        ${payoutAccount.bank_name},
        ${payoutAccount.last_four_digits},
        'pending'
      )
      RETURNING id
    `;

    try {
    const sql = getDatabase();
      // Create Stripe transfer to Connect account
      const transfer = await stripe.transfers.create({
        amount: Math.round(netAmount * 100), // Convert to cents
        currency: 'usd',
        destination: payoutAccount.stripe_connect_account_id,
        description: description || `Payout to ${user.first_name} ${user.last_name}`,
        metadata: {
          user_id: user.id,
          clerk_id: clerkId,
          transaction_id: transaction.id,
          original_amount: amount.toString(),
          platform_fee: platformFee.toString(),
        },
      });

      // Update transaction with Stripe transfer ID
      await sql`
        UPDATE payout_transactions
        SET 
          stripe_transfer_id = ${transfer.id},
          status = 'processing',
          processed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${transaction.id}
      `;

      // Update earnings summary to reflect pending withdrawal
      await sql`
        UPDATE driver_earnings_summary
        SET 
          pending_withdrawal = pending_withdrawal + ${netAmount},
          updated_at = NOW()
        WHERE user_id = ${user.id}
      `;

      return Response.json({
        success: true,
        transaction: {
          id: transaction.id,
          amount: amount,
          platform_fee: platformFee,
          stripe_fee: stripeFee,
          net_amount: netAmount,
          status: 'processing',
          stripe_transfer_id: transfer.id,
          description: description || `Withdrawal by ${user.first_name} ${user.last_name}`,
          expected_arrival: '1-2 business days',
        },
        message: 'Withdrawal request submitted successfully'
      });

    } catch (stripeError) {
      console.error('Stripe transfer error:', stripeError);
      
      // Update transaction status to failed
      await sql`
        UPDATE payout_transactions
        SET 
          status = 'failed',
          failure_reason = ${stripeError instanceof Error ? stripeError.message : 'Stripe transfer failed'},
          updated_at = NOW()
        WHERE id = ${transaction.id}
      `;

      return Response.json({ 
        error: 'Failed to process withdrawal',
        details: stripeError instanceof Error ? stripeError.message : 'Unknown Stripe error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Withdrawal error:', error);
    return Response.json({ 
      error: 'Failed to process withdrawal request',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const { searchParams } = new URL(request.url);
    const clerkId = searchParams.get('clerkId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

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

    // Get withdrawal history
    const transactions = await sql`
      SELECT 
        id,
        amount,
        platform_fee,
        stripe_fee,
        net_amount,
        status,
        description,
        destination_bank_name,
        destination_last_four,
        stripe_transfer_id,
        stripe_payout_id,
        failure_reason,
        failure_code,
        expected_arrival_date,
        processed_at,
        arrived_at,
        created_at
      FROM payout_transactions
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Get total count
    const [countResult] = await sql`
      SELECT COUNT(*) as total
      FROM payout_transactions
      WHERE user_id = ${user.id}
    `;

    return Response.json({
      success: true,
      transactions: transactions.map(tx => ({
        id: tx.id,
        amount: parseFloat(tx.amount),
        platform_fee: parseFloat(tx.platform_fee),
        stripe_fee: parseFloat(tx.stripe_fee),
        net_amount: parseFloat(tx.net_amount),
        status: tx.status,
        description: tx.description,
        bank_name: tx.destination_bank_name,
        last_four: tx.destination_last_four,
        stripe_transfer_id: tx.stripe_transfer_id,
        stripe_payout_id: tx.stripe_payout_id,
        failure_reason: tx.failure_reason,
        failure_code: tx.failure_code,
        expected_arrival_date: tx.expected_arrival_date,
        processed_at: tx.processed_at,
        arrived_at: tx.arrived_at,
        created_at: tx.created_at,
      })),
      pagination: {
        total: parseInt(countResult.total),
        limit,
        offset,
        has_more: parseInt(countResult.total) > offset + limit,
      }
    });

  } catch (error) {
    console.error('Get withdrawal history error:', error);
    return Response.json({ 
      error: 'Failed to get withdrawal history',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}