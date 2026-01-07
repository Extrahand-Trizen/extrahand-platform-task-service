import { Request } from 'express';
import mongoose from 'mongoose';

// Extended Express Request with user (set by gatewayAuthMiddleware)
export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    sessionId?: string;
    token?: string;  // Token string from Authorization header
    profileId?: mongoose.Types.ObjectId; // ObjectId reference to Profile
  };
  rateLimitUserId?: string;
}

// Location interface
export interface Location {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
  address: string;
  city: string;
  state: string;
  pinCode?: string;
  country?: string;
}

// Task types
export type TaskCategory = 'cleaning' | 'repair' | 'delivery' | 'assembly' | 'gardening' | 'petcare' | 'other';
export type TaskStatus = 'open' | 'assigned' | 'started' | 'in_progress' | 'review' | 'completed' | 'cancelled';
export type BudgetType = 'fixed' | 'hourly' | 'negotiable';
export type Urgency = 'low' | 'medium' | 'high' | 'urgent';
export type Priority = 'low' | 'normal' | 'high';
export type Flexibility = 'strict' | 'flexible' | 'anytime';
export type CompletionStatus = 'pending_approval' | 'approved' | 'rejected';

// Application types
export type ApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

// Review types
export interface ReviewRatings {
  communication?: number;
  quality?: number;
  timeliness?: number;
  professionalism?: number;
  value?: number;
}

// Service response types
export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

