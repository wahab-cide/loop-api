import { getDatabase } from '@/lib/database';


export async function POST(request: Request) {
  try {
    const sql = getDatabase();
    const { jobType, apiKey } = await request.json();

    if (apiKey !== process.env.BACKGROUND_JOB_API_KEY) {
      return Response.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    if (!jobType || !['expire_rides', 'complete_rides', 'refresh_ratings'].includes(jobType)) {
      return Response.json({ 
        success: false, 
        error: 'Invalid job type. Must be: expire_rides, complete_rides, or refresh_ratings' 
      }, { status: 400 });
    }

    // Create job record
    const [job] = await sql`
      INSERT INTO background_jobs (job_type, status, started_at)
      VALUES (${jobType}, 'running', NOW())
      RETURNING id, created_at
    `;

    let affectedRows = 0;
    let errorMessage = null;

    try {
    const sql = getDatabase();
      switch (jobType) {
        case 'expire_rides':
          affectedRows = await expireOldRides();
          break;
        case 'complete_rides':
          affectedRows = await autoCompleteRides();
          break;
        case 'refresh_ratings':
          await refreshRatingSummaries();
          affectedRows = 1; // Indicate success
          break;
        default:
          throw new Error('Unknown job type');
      }

      // Mark job as completed
      await sql`
        UPDATE background_jobs 
        SET 
          status = 'completed',
          completed_at = NOW(),
          affected_rows = ${affectedRows}
        WHERE id = ${job.id}
      `;

      if (process.env.NODE_ENV === 'development') console.log(`Background job ${jobType} completed successfully. Affected rows: ${affectedRows}`);

    } catch (jobError) {
      errorMessage = jobError instanceof Error ? jobError.message : 'Unknown error';
      
      // Mark job as failed
      await sql`
        UPDATE background_jobs 
        SET 
          status = 'failed',
          completed_at = NOW(),
          error_message = ${errorMessage}
        WHERE id = ${job.id}
      `;

      if (process.env.NODE_ENV === 'development') console.error(`Background job ${jobType} failed:`, jobError);
    }

    return Response.json({
      success: errorMessage === null,
      message: errorMessage ? `Job failed: ${errorMessage}` : `Job ${jobType} completed successfully`,
      jobId: job.id,
      affectedRows: affectedRows,
      error: errorMessage
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.error('Error in background job API:', error);
    return Response.json({
      success: false,
      error: 'Failed to process background job',
      details: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error'
    }, { status: 500 });
  }
}

// Function to expire old rides (only rides WITHOUT confirmed bookings)
async function expireOldRides(): Promise<number> {
  // Update rides that are past departure time, don't have paid bookings, and are still open/full
  const expiredRides = await sql`
    UPDATE rides 
    SET 
      status = 'expired',
      auto_completed = TRUE,
      updated_at = NOW()
    WHERE 
      departure_time < NOW() - INTERVAL '2 hours'
      AND status IN ('open', 'full')
      AND status != 'expired'
      AND NOT EXISTS (
        SELECT 1 FROM bookings 
        WHERE ride_id = rides.id AND status = 'paid'
      )
    RETURNING id
  `;

  if (expiredRides.length > 0) {
    // Update associated pending bookings to expired
    await sql`
      UPDATE bookings 
      SET 
        status = 'expired',
        updated_at = NOW()
      WHERE 
        ride_id = ANY(${expiredRides.map(r => r.id)})
        AND status = 'pending'
    `;
  }

  return expiredRides.length;
}

// Function to auto-complete rides (rides WITH confirmed bookings after grace period)
async function autoCompleteRides(): Promise<number> {
  // Update rides that are 2+ hours past departure and have paid bookings
  const completedRides = await sql`
    UPDATE rides 
    SET 
      status = 'completed',
      completed_at = NOW(),
      auto_completed = TRUE,
      updated_at = NOW()
    WHERE 
      departure_time < NOW() - INTERVAL '2 hours'
      AND status IN ('open', 'full')
      AND EXISTS (
        SELECT 1 FROM bookings 
        WHERE ride_id = rides.id AND status = 'paid'
      )
    RETURNING id
  `;

  if (completedRides.length > 0) {
    // Update associated paid bookings to completed
    await sql`
      UPDATE bookings 
      SET 
        status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
      WHERE 
        ride_id = ANY(${completedRides.map(r => r.id)})
        AND status = 'paid'
    `;
  }

  return completedRides.length;
}

// Function to refresh rating summaries
async function refreshRatingSummaries(): Promise<void> {
  // Refresh the materialized view
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY user_rating_summary`;
  
  // Update users table with latest ratings
  await sql`
    UPDATE users 
    SET 
      rating_driver = COALESCE(urs.avg_driver_rating, 5.00),
      rating_rider = COALESCE(urs.avg_rider_rating, 5.00)
    FROM user_rating_summary urs 
    WHERE users.id = urs.user_id
  `;
}

// GET endpoint to check job status
export async function GET(request: Request) {
  try {
    const sql = getDatabase();
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');
    const limit = parseInt(url.searchParams.get('limit') || '10');

    if (jobId) {
      // Get specific job
      const [job] = await sql`
        SELECT * FROM background_jobs WHERE id = ${jobId}
      `;

      if (!job) {
        return Response.json({ 
          success: false, 
          error: 'Job not found' 
        }, { status: 404 });
      }

      return Response.json({
        success: true,
        job: job
      });
    } else {
      // Get recent jobs
      const jobs = await sql`
        SELECT * FROM background_jobs 
        ORDER BY created_at DESC 
        LIMIT ${limit}
      `;

      return Response.json({
        success: true,
        jobs: jobs
      });
    }

  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.error('Error fetching job status:', error);
    return Response.json({
      success: false,
      error: 'Failed to fetch job status'
    }, { status: 500 });
  }
}