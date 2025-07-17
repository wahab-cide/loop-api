import { getDatabase } from '@/lib/database';
import { getStripe } from '@/lib/stripe';

const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET!;

export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const stripe = getStripe();
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    // Enhanced logging for debugging
    console.log('Connect webhook request received:', {
      bodyLength: body.length,
      hasSignature: !!signature,
      timestamp: new Date().toISOString()
    });

    if (!signature) {
      console.error('No Stripe signature header found in Connect webhook');
      return Response.json({ error: 'No signature provided' }, { status: 400 });
    }

    // Validate body size (Stripe recommends max 2MB)
    if (body.length > 2 * 1024 * 1024) {
      console.error('Connect webhook request body too large:', body.length);
      return Response.json({ error: 'Request body too large' }, { status: 413 });
    }

    let event: Stripe.Event;

    try {
    const sql = getDatabase();
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error('Connect webhook signature verification failed:', {
        error: err.message,
        type: err.type,
        raw: err.raw,
        header: err.header,
        payload: err.payload ? err.payload.substring(0, 200) + '...' : 'no payload',
        bodyLength: body.length,
        signatureHeader: signature?.substring(0, 50) + '...',
        webhookSecretLength: webhookSecret.length
      });
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle the event
    console.log(`Processing Connect event: ${event.type} (ID: ${event.id})`);
    
    switch (event.type) {
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      case 'account.external_account.created':
        await handleExternalAccountCreated(event.data.object as Stripe.ExternalAccount, event.account);
        break;
      case 'account.external_account.updated':
        await handleExternalAccountUpdated(event.data.object as Stripe.ExternalAccount, event.account);
        break;
      case 'transfer.created':
        await handleTransferCreated(event.data.object as Stripe.Transfer);
        break;
      case 'transfer.updated':
        await handleTransferUpdated(event.data.object as Stripe.Transfer);
        break;
      case 'payout.created':
        await handlePayoutCreated(event.data.object as Stripe.Payout, event.account);
        break;
      case 'payout.updated':
        await handlePayoutUpdated(event.data.object as Stripe.Payout, event.account);
        break;
      case 'payout.paid':
        await handlePayoutPaid(event.data.object as Stripe.Payout, event.account);
        break;
      case 'payout.failed':
        await handlePayoutFailed(event.data.object as Stripe.Payout, event.account);
        break;
      default:
        console.log(`Unhandled Connect event type: ${event.type}`);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Connect webhook error:', error);
    return Response.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

async function handleAccountUpdated(account: Stripe.Account) {
  try {
    const sql = getDatabase();
    if (!account.id) return;

    // Update account status in database
    const accountStatus = account.charges_enabled ? 'active' : 'pending';
    const onboardingCompleted = account.details_submitted && 
                               account.charges_enabled && 
                               account.payouts_enabled;

    await sql`
      UPDATE driver_payout_accounts
      SET 
        account_status = ${accountStatus},
        onboarding_completed = ${onboardingCompleted},
        details_submitted = ${account.details_submitted},
        charges_enabled = ${account.charges_enabled},
        payouts_enabled = ${account.payouts_enabled},
        requirements_due = ${account.requirements?.currently_due || []},
        capabilities_enabled = ${Object.keys(account.capabilities || {})},
        updated_at = NOW()
      WHERE stripe_connect_account_id = ${account.id}
    `;

    console.log(`Updated Connect account ${account.id}: status=${accountStatus}, payouts_enabled=${account.payouts_enabled}`);
  } catch (error) {
    console.error('Error handling account updated:', error);
  }
}

async function handleExternalAccountCreated(externalAccount: Stripe.ExternalAccount, accountId?: string) {
  try {
    const sql = getDatabase();
    if (!accountId || externalAccount.object !== 'bank_account') return;

    const bankAccount = externalAccount as Stripe.BankAccount;

    // Update bank account info in database
    await sql`
      UPDATE driver_payout_accounts
      SET 
        bank_account_id = ${bankAccount.id},
        bank_name = ${bankAccount.bank_name || 'Unknown Bank'},
        account_type = ${bankAccount.account_type || 'checking'},
        last_four_digits = ${bankAccount.last4},
        routing_number_last_four = ${bankAccount.routing_number?.slice(-4) || null},
        updated_at = NOW()
      WHERE stripe_connect_account_id = ${accountId}
    `;

    console.log(`Added bank account to Connect account ${accountId}: ${bankAccount.bank_name} ****${bankAccount.last4}`);
  } catch (error) {
    console.error('Error handling external account created:', error);
  }
}

async function handleExternalAccountUpdated(externalAccount: Stripe.ExternalAccount, accountId?: string) {
  try {
    const sql = getDatabase();
    if (!accountId || externalAccount.object !== 'bank_account') return;

    const bankAccount = externalAccount as Stripe.BankAccount;

    // Update bank account info in database
    await sql`
      UPDATE driver_payout_accounts
      SET 
        bank_name = ${bankAccount.bank_name || 'Unknown Bank'},
        account_type = ${bankAccount.account_type || 'checking'},
        last_four_digits = ${bankAccount.last4},
        routing_number_last_four = ${bankAccount.routing_number?.slice(-4) || null},
        updated_at = NOW()
      WHERE stripe_connect_account_id = ${accountId}
        AND bank_account_id = ${bankAccount.id}
    `;

    console.log(`Updated bank account for Connect account ${accountId}`);
  } catch (error) {
    console.error('Error handling external account updated:', error);
  }
}

async function handleTransferCreated(transfer: Stripe.Transfer) {
  try {
    const sql = getDatabase();
    const transactionId = transfer.metadata?.transaction_id;
    if (!transactionId) return;

    // Update transaction with transfer details
    await sql`
      UPDATE payout_transactions
      SET 
        stripe_transfer_id = ${transfer.id},
        status = 'processing',
        processed_at = NOW(),
        updated_at = NOW()
      WHERE id = ${transactionId}
    `;

    console.log(`Transfer created for transaction ${transactionId}: ${transfer.id}`);
  } catch (error) {
    console.error('Error handling transfer created:', error);
  }
}

async function handleTransferUpdated(transfer: Stripe.Transfer) {
  try {
    const sql = getDatabase();
    const transactionId = transfer.metadata?.transaction_id;
    if (!transactionId) return;

    // Map Stripe transfer status to our status
    let status = 'processing';
    if (transfer.reversed) {
      status = 'failed';
    }

    await sql`
      UPDATE payout_transactions
      SET 
        status = ${status},
        updated_at = NOW()
      WHERE stripe_transfer_id = ${transfer.id}
    `;

    console.log(`Transfer updated: ${transfer.id} -> ${status}`);
  } catch (error) {
    console.error('Error handling transfer updated:', error);
  }
}

async function handlePayoutCreated(payout: Stripe.Payout, accountId?: string) {
  try {
    const sql = getDatabase();
    if (!accountId) return;

    // Find transactions that might be related to this payout
    // Note: Stripe doesn't directly link transfers to payouts in metadata
    // We'll update based on amount and timing
    const createdAt = new Date(payout.created * 1000);
    const windowStart = new Date(createdAt.getTime() - 60 * 60 * 1000); // 1 hour before
    
    await sql`
      UPDATE payout_transactions
      SET 
        stripe_payout_id = ${payout.id},
        status = 'in_transit',
        expected_arrival_date = ${new Date(payout.arrival_date * 1000).toISOString().split('T')[0]},
        updated_at = NOW()
      WHERE stripe_transfer_id IN (
        SELECT stripe_transfer_id 
        FROM payout_transactions pt
        JOIN driver_payout_accounts dpa ON pt.user_id = dpa.user_id
        WHERE dpa.stripe_connect_account_id = ${accountId}
          AND pt.status = 'processing'
          AND pt.processed_at >= ${windowStart.toISOString()}
          AND pt.stripe_payout_id IS NULL
        LIMIT 1
      )
    `;

    console.log(`Payout created: ${payout.id} for account ${accountId}`);
  } catch (error) {
    console.error('Error handling payout created:', error);
  }
}

async function handlePayoutUpdated(payout: Stripe.Payout, accountId?: string) {
  try {
    const sql = getDatabase();
    if (!accountId) return;

    let status = 'in_transit';
    if (payout.status === 'paid') {
      status = 'paid';
    } else if (payout.status === 'failed') {
      status = 'failed';
    } else if (payout.status === 'canceled') {
      status = 'canceled';
    }

    await sql`
      UPDATE payout_transactions
      SET 
        status = ${status},
        ${payout.status === 'paid' ? sql`arrived_at = NOW(),` : sql``}
        ${payout.failure_message ? sql`failure_reason = ${payout.failure_message},` : sql``}
        ${payout.failure_code ? sql`failure_code = ${payout.failure_code},` : sql``}
        updated_at = NOW()
      WHERE stripe_payout_id = ${payout.id}
    `;

    console.log(`Payout updated: ${payout.id} -> ${status}`);
  } catch (error) {
    console.error('Error handling payout updated:', error);
  }
}

async function handlePayoutPaid(payout: Stripe.Payout, accountId?: string) {
  try {
    const sql = getDatabase();
    if (!accountId) return;

    // Update transaction to completed and update earnings summary
    const [transaction] = await sql`
      UPDATE payout_transactions
      SET 
        status = 'paid',
        arrived_at = NOW(),
        updated_at = NOW()
      WHERE stripe_payout_id = ${payout.id}
      RETURNING user_id, net_amount
    `;

    if (transaction) {
      // Update earnings summary - move from pending to withdrawn
      await sql`
        UPDATE driver_earnings_summary
        SET 
          total_withdrawn = total_withdrawn + ${transaction.net_amount},
          pending_withdrawal = pending_withdrawal - ${transaction.net_amount},
          last_payout_amount = ${transaction.net_amount},
          last_payout_at = NOW(),
          total_payouts = total_payouts + 1,
          updated_at = NOW()
        WHERE user_id = ${transaction.user_id}
      `;

      console.log(`Payout completed: ${payout.id}, amount: ${transaction.net_amount} for user ${transaction.user_id}`);
    }
  } catch (error) {
    console.error('Error handling payout paid:', error);
  }
}

async function handlePayoutFailed(payout: Stripe.Payout, accountId?: string) {
  try {
    const sql = getDatabase();
    if (!accountId) return;

    // Update transaction to failed and restore available balance
    const [transaction] = await sql`
      UPDATE payout_transactions
      SET 
        status = 'failed',
        failure_reason = ${payout.failure_message || 'Payout failed'},
        failure_code = ${payout.failure_code || 'unknown'},
        updated_at = NOW()
      WHERE stripe_payout_id = ${payout.id}
      RETURNING user_id, net_amount
    `;

    if (transaction) {
      // Restore available balance - remove from pending withdrawal
      await sql`
        UPDATE driver_earnings_summary
        SET 
          pending_withdrawal = pending_withdrawal - ${transaction.net_amount},
          updated_at = NOW()
        WHERE user_id = ${transaction.user_id}
      `;

      console.log(`Payout failed: ${payout.id}, restored ${transaction.net_amount} to user ${transaction.user_id}`);
    }
  } catch (error) {
    console.error('Error handling payout failed:', error);
  }
}