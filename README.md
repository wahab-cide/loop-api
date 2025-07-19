# Loop API

Backend API services for the Loop rideshare application.

## Overview

This is the standalone API backend for Loop, a rideshare application built with React Native. The API handles:

- User authentication and management
- Ride creation and search
- Booking system
- Payment processing (Stripe)
- Real-time chat
- Push notifications
- Driver verification and payouts

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Next.js API Routes (serverless)
- **Database**: PostgreSQL (Neon Database)
- **Authentication**: Clerk
- **Payments**: Stripe & Stripe Connect
- **Notifications**: Expo Push Notifications
- **Deployment**: Vercel

## API Structure

```
app/api/
├── (stripe)/           # Stripe payment endpoints
├── admin/              # Admin management endpoints
├── bookings/           # Booking management
├── chat/               # Real-time messaging
├── cron/               # Automated tasks
├── driver/             # Driver verification & management
├── notifications/      # Push notification system
├── payout/             # Driver earnings & payouts
├── ratings/            # Rating & review system
├── rides/              # Ride management
├── user+api.ts         # User profile management
└── webhooks/           # External service webhooks
```

## Environment Variables

Required environment variables:

```env
# Database
DATABASE_URL=postgresql://...

# Clerk Authentication
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...

# Development
NODE_ENV=development
```

## Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```

4. **Test API endpoints**:
   ```bash
   curl http://localhost:3000/api/rides/feed
   ```

## Deployment

### Vercel Deployment

1. **Connect to Vercel**:
   ```bash
   vercel link
   ```

2. **Set environment variables**:
   ```bash
   vercel env add DATABASE_URL
   vercel env add CLERK_SECRET_KEY
   vercel env add STRIPE_SECRET_KEY
   # ... add all required env vars
   ```

3. **Deploy**:
   ```bash
   npm run deploy
   ```

### Manual Deployment

1. **Build for production**:
   ```bash
   npm run build
   ```

2. **Deploy to Vercel**:
   ```bash
   vercel --prod
   ```

## API Endpoints

### Authentication
- `POST /api/user` - Create/update user profile

### Rides
- `GET /api/rides/feed` - Get available rides
- `POST /api/rides/create` - Create new ride (drivers only)
- `POST /api/rides/search` - Search rides by location
- `GET /api/rides/[rideId]` - Get ride details

### Bookings
- `POST /api/bookings/create` - Create booking request
- `POST /api/bookings/[bookingId]/approve` - Approve booking
- `POST /api/bookings/[bookingId]/cancel` - Cancel booking

### Payments
- `POST /api/(stripe)/create` - Create payment intent
- `POST /api/(stripe)/pay` - Process payment

### Chat
- `GET /api/chat/messages/[threadId]` - Get messages
- `POST /api/chat/messages/[threadId]` - Send message

### Notifications
- `POST /api/notifications/register-token` - Register push token
- `GET /api/notifications/preferences` - Get user preferences

## Database Schema

The API uses PostgreSQL with the following main tables:

- `users` - User profiles and authentication
- `rides` - Ride postings and details
- `bookings` - Booking requests and confirmations
- `chat_threads` & `chat_messages` - In-app messaging
- `ride_ratings` - Rating and review system
- `driver_payout_accounts` - Stripe Connect accounts
- `notification_log` - Push notification tracking

See `database/schema.sql` for the complete schema.

## Error Handling

The API uses consistent error responses:

```json
{
  "error": "Error message",
  "details": "Optional detailed error information"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

## Rate Limiting

API endpoints are rate-limited to prevent abuse:
- General endpoints: 100 requests/minute
- Authentication: 10 requests/minute
- Payment endpoints: 5 requests/minute

## Security

- All API routes require authentication except webhooks
- Input validation on all endpoints
- SQL injection prevention with parameterized queries
- CORS enabled for mobile app origins
- Environment variables for sensitive data

## Monitoring

- Request logging via Vercel Functions
- Error tracking and alerting
- Performance monitoring
- Database query optimization

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

Private - All rights reserved.