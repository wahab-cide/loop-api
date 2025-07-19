// Server-side booking types for the API
export interface CreateBookingParams {
  clerkId: string;
  rideId: string;
  seatsRequested: number;
  paymentIntentId?: string;
}

export interface BookingResponse {
  success: boolean;
  bookingId?: string;
  error?: string;
  message?: string;
}