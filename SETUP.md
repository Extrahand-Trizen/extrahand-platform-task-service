# ExtraHand Task Service - Setup Guide

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` and fill in your configuration values.

### 3. Firebase Service Account Key

**IMPORTANT**: Place your `serviceAccountKey.json` file in the **service root directory**:

```
extrahand-task-service/
  ├── serviceAccountKey.json  ← Place it here
  ├── .env
  ├── package.json
  └── src/
```

**Security Note**: 
- ✅ `serviceAccountKey.json` is already in `.gitignore`
- ❌ NEVER commit this file to version control
- ✅ For production, use environment variables instead

### 4. Start the Service

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

The service will start on port **4002** (or the port specified in `.env`).

## 📋 Required Environment Variables

### Critical (Must Have)

- `MONGODB_URI` - MongoDB connection string
- `SERVICE_AUTH_TOKEN` - Shared secret for inter-service communication
- Firebase credentials (either `serviceAccountKey.json` file OR env vars)

### Optional (Have Defaults)

- `PORT` - Service port (default: 4002)
- `NODE_ENV` - Environment (default: development)
- `MONGODB_DB` - Database name (default: extrahand)
- `LOG_LEVEL` - Logging level (default: info)

### Service URLs (for inter-service calls)

- `USER_SERVICE_URL` - User Service URL (default: http://localhost:4001)
- `MESSAGING_SERVICE_URL` - Messaging Service URL (default: http://localhost:4006)
- `PAYMENT_SERVICE_URL` - Payment Service URL (default: http://localhost:4003)

## 🔐 Firebase Setup Options

### Option 1: Service Account File (Recommended for Local)

1. Copy `serviceAccountKey.json` from `task-connect-relay/` to `extrahand-task-service/`
2. No additional env vars needed
3. The service will automatically detect and use it

### Option 2: Environment Variables (Recommended for Production)

Set these in your `.env` file:
```
FIREBASE_PROJECT_ID=extrahand-app
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@extrahand-app.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Option 3: Custom Path

Set `FIREBASE_SERVICE_ACCOUNT_PATH` to the full path of your service account file.

### Option 4: Google Application Default Credentials

Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable.

## 🗄️ MongoDB Setup

### Local MongoDB

```bash
# Install MongoDB locally or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Connection string
MONGODB_URI=mongodb://localhost:27017
```

### MongoDB Atlas (Cloud)

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/extrahand
```

## 🔗 Service-to-Service Communication

All services must share the same `SERVICE_AUTH_TOKEN`:

```bash
# Generate a secure token
openssl rand -hex 32
```

Use this token in **all services** (User, Task, Messaging, Payment, Verification).

## 📦 Storage Configuration

**Note**: Task Service doesn't directly use storage, but may need it for future task image uploads.

### MinIO (Local Development)

```bash
# Run MinIO with Docker
docker run -d -p 9000:9000 -p 9001:9001 \
  --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data --console-address ":9001"
```

### AWS S3 (Production)

Set these in `.env` if needed:
```
STORAGE_PROVIDER=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET_NAME=extrahand-images
```

## ✅ Health Check

Once running, verify the service is healthy:

```bash
curl http://localhost:4002/api/v1/health
```

Expected response:
```json
{
  "success": true,
  "service": "extrahand-task-service",
  "status": "healthy",
  "timestamp": "2024-..."
}
```

## 🐛 Troubleshooting

### Firebase Not Initializing

1. Check if `serviceAccountKey.json` exists in service root
2. Verify file permissions
3. Check environment variables if using env vars
4. Review logs for specific error messages

### MongoDB Connection Failed

1. Verify MongoDB is running: `mongosh` or `mongo`
2. Check `MONGODB_URI` format
3. Verify network connectivity
4. Check MongoDB logs

### Service-to-Service Auth Failing

1. Ensure `SERVICE_AUTH_TOKEN` is identical across all services
2. Check service URLs are correct
3. Verify services are running on expected ports

## 📝 Notes

- The service uses the same MongoDB database as the original backend
- All services share the same `SERVICE_AUTH_TOKEN` for inter-service communication
- `serviceAccountKey.json` should be in the service root, not in `src/`
- For production, prefer environment variables over files
- Task Service calls User Service for profile data (getUserName helper)



