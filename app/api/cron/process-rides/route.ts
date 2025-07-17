export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const authToken = url.searchParams.get('auth');
    const jobType = url.searchParams.get('type') || 'complete_rides';
    
    // Validate authentication token
    if (!authToken || authToken !== process.env.CRON_SECRET) {
      return Response.json({ 
        success: false, 
        error: 'Unauthorized - Invalid auth token' 
      }, { status: 401 });
    }

    // Validate job type
    if (!['expire_rides', 'complete_rides', 'refresh_ratings'].includes(jobType)) {
      return Response.json({ 
        success: false, 
        error: 'Invalid job type. Must be: expire_rides, complete_rides, or refresh_ratings' 
      }, { status: 400 });
    }

    if (process.env.NODE_ENV === 'development') console.log(`Cron job triggered: ${jobType} at ${new Date().toISOString()}`);

    // Call the existing background job API internally
    const jobResponse = await fetch(`${url.origin}/(api)/jobs/process-rides`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jobType: jobType,
        apiKey: process.env.BACKGROUND_JOB_API_KEY
      })
    });

    if (!jobResponse.ok) {
      throw new Error(`Job API responded with status: ${jobResponse.status}`);
    }

    const jobResult = await jobResponse.json();

    if (process.env.NODE_ENV === 'development') console.log(`Cron job completed: ${jobType}`, {
      success: jobResult.success,
      affectedRows: jobResult.affectedRows,
      jobId: jobResult.jobId
    });

    return Response.json({
      success: true,
      message: `Cron job ${jobType} executed successfully`,
      timestamp: new Date().toISOString(),
      jobType: jobType,
      result: jobResult
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.error('Error in cron job:', error);
    
    return Response.json({
      success: false,
      error: 'Failed to execute cron job',
      message: error instanceof Error ? error instanceof Error ? error.message : "Unknown error" : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}