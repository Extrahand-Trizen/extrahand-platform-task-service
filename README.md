# ExtraHand Task Service

Task Service for ExtraHand Platform - Handles tasks, applications, reviews, and task-related operations.

## Features

- Task Management (CRUD operations)
- Application Management
- Reviews & Ratings
- Task Completion Workflow
- Geospatial Queries (Nearby Tasks)
- Task Questions, Follows, and Reports

## Port

**4002**

## API Endpoints

### Tasks
- `GET /api/v1/tasks` - Get all tasks
- `GET /api/v1/tasks/nearby` - Get nearby tasks (geospatial)
- `GET /api/v1/tasks/my-tasks` - Get tasks posted by current user
- `GET /api/v1/tasks/:id` - Get a single task
- `POST /api/v1/tasks` - Create a new task
- `PUT /api/v1/tasks/:id` - Update a task
- `DELETE /api/v1/tasks/:id` - Delete a task

### Applications
- `POST /api/v1/applications` - Submit application
- `GET /api/v1/applications` - Get applications
- `POST /api/v1/applications/:id/accept` - Accept an application
- `POST /api/v1/applications/:id/reject` - Reject an application
- `POST /api/v1/applications/:id/withdraw` - Withdraw an application

### Reviews
- `POST /api/v1/reviews` - Create a review
- `GET /api/v1/reviews/task/:taskId` - Get review for a task
- `GET /api/v1/reviews/user/:userId` - Get reviews for a user

### Completion
- `POST /api/v1/tasks/:taskId/complete` - Submit completion proof
- `POST /api/v1/tasks/:taskId/approve-completion` - Approve completion
- `POST /api/v1/tasks/:taskId/reject-completion` - Reject completion

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Environment Variables

See `.env.example` for required environment variables.

## Deployment

The service is configured for CapRover deployment with:
- Dockerfile for containerization
- captain-definition for CapRover configuration
- Health check endpoint at `/api/v1/health`
