import TaskApplication, { ITaskApplication } from '../models/TaskApplication';
import Task from '../models/Task';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError';
import logger from '../config/logger';
import { ApplicationStatus } from '../types';
import mongoose from 'mongoose';

export class ApplicationService {
  /**
   * Submit application for a task
   */
  static async submitApplication(
    taskId: string,
    applicantUid: string,
    applicationData: {
      proposedBudget: { amount: number; currency?: string; isNegotiable?: boolean };
      proposedTime?: any;
      coverLetter?: string;
      relevantExperience?: string[];
      portfolio?: string[];
    }
  ): Promise<ITaskApplication> {
    // Check if task exists and is open
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (task.status !== 'open') {
      throw new BadRequestError('Task is not open for applications');
    }

    if (task.requesterId === applicantUid) {
      throw new BadRequestError('Cannot apply to your own task');
    }

    // Check if user has already applied
    const existingApplication = await TaskApplication.findOne({
      taskId,
      applicantUid,
    });

    if (existingApplication) {
      throw new BadRequestError('You have already applied to this task');
    }

    // Create application
    const application = await TaskApplication.create({
      taskId,
      applicantUid,
      proposedBudget: {
        amount: Number(applicationData.proposedBudget?.amount || applicationData.proposedBudget),
        currency: applicationData.proposedBudget?.currency || 'INR',
        isNegotiable: applicationData.proposedBudget?.isNegotiable !== false,
      },
      proposedTime: applicationData.proposedTime || { flexible: true },
      coverLetter: applicationData.coverLetter || '',
      relevantExperience: Array.isArray(applicationData.relevantExperience) ? applicationData.relevantExperience : [],
      portfolio: Array.isArray(applicationData.portfolio) ? applicationData.portfolio : [],
    });

    // Increment task applications count (atomic operation)
    await Task.updateOne(
      { _id: taskId },
      { $inc: { applications: 1 } }
    );

    logger.info(`Application submitted: ${application._id} for task ${taskId} by user ${applicantUid}`);
    return application;
  }

  /**
   * Get applications with authorization checks
   */
  static async getApplications(
    currentUserUid: string,
    filters: {
      taskId?: string;
      mine?: boolean;
      status?: ApplicationStatus;
      limit?: number;
      page?: number;
    }
  ): Promise<{ applications: any[]; pagination: any }> {
    const { taskId, mine, status, limit = 20, page = 1 } = filters;
    const pageSize = Math.min(limit, 100);
    const pageNum = page;
    const skip = (pageNum - 1) * pageSize;

    const query: any = {};

    // Get applications for a specific task (task creator only)
    if (taskId) {
      const task = await Task.findById(taskId);
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      // Only task owner can view applications for their task
      if (task.requesterId !== currentUserUid) {
        throw new ForbiddenError('Not authorized to view applications for this task');
      }

      query.taskId = taskId;
    }

    // Get my applications
    if (mine) {
      query.applicantUid = currentUserUid;
    }

    // Status filter
    if (status && ['pending', 'accepted', 'rejected', 'withdrawn'].includes(status)) {
      query.status = status;
    }

    // Execute query - populate taskId
    const applications = await TaskApplication.find(query)
      .populate('taskId', 'title category budget location status requesterId requesterName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();

    // Manually fetch applicant profiles using UID
    const Profile = mongoose.connection.collection('profiles');
    const enrichedApplications = await Promise.all(
      applications.map(async (app) => {
        try {
          const applicantProfile = await Profile.findOne({ uid: app.applicantUid });
          return {
            ...app,
            applicantProfile: applicantProfile ? {
              name: applicantProfile.name,
              photoURL: applicantProfile.photoURL,
              rating: applicantProfile.rating,
              totalReviews: applicantProfile.totalReviews,
              skills: applicantProfile.skills
            } : null
          };
        } catch (error) {
          logger.warn('Could not fetch applicant profile for', app.applicantUid);
          return app;
        }
      })
    );

    // Get total count for pagination
    const total = await TaskApplication.countDocuments(query);

    const results = enrichedApplications.map(app => ({
      id: String(app._id),
      ...app
    }));

    return {
      applications: results,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    };
  }

  /**
   * Update application status (PUT endpoint)
   */
  static async updateApplication(
    applicationId: string,
    taskOwnerUid: string,
    updateData: { status?: ApplicationStatus; message?: string }
  ): Promise<ITaskApplication> {
    const { status, message } = updateData;
    
    const application = await TaskApplication.findById(applicationId)
      .populate('taskId', 'requesterId status');
    
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    // Only task creator can update application status
    const task = application.taskId as any;
    if (task.requesterId !== taskOwnerUid) {
      throw new ForbiddenError('Not authorized to update this application');
    }

    // Validate status transition
    if (status === 'accepted') {
      if (task.status !== 'open') {
        throw new BadRequestError('Task is not open for assignment');
      }
      
      // Reject all other pending applications for this task
      await TaskApplication.updateMany(
        { 
          taskId: task._id, 
          _id: { $ne: applicationId },
          status: 'pending'
        },
        { status: 'rejected' }
      );
      
      // Update task status to assigned
      await Task.updateOne(
        { _id: task._id },
        { 
          status: 'assigned',
          assigneeUid: application.applicantUid,
          updatedAt: new Date()
        }
      );
    }

    // Update application status
    application.status = status || application.status;
    application.updatedAt = new Date();

    // Add message if provided
    if (message) {
      if (!application.messages) {
        application.messages = [];
      }
      application.messages.push({
        senderUid: taskOwnerUid,
        message,
        timestamp: new Date(),
        isRead: false
      });
    }

    await application.save();

    return application;
  }

  /**
   * Accept an application
   */
  static async acceptApplication(applicationId: string, taskOwnerUid: string): Promise<ITaskApplication> {
    return this.updateApplication(applicationId, taskOwnerUid, { status: 'accepted' });
  }

  /**
   * Reject an application
   */
  static async rejectApplication(applicationId: string, taskOwnerUid: string): Promise<ITaskApplication> {
    return this.updateApplication(applicationId, taskOwnerUid, { status: 'rejected' });
  }

  /**
   * Withdraw an application
   */
  static async withdrawApplication(applicationId: string, applicantUid: string): Promise<void> {
    const application = await TaskApplication.findById(applicationId);
    if (!application) {
      throw new NotFoundError('Application not found');
    }

    if (application.applicantUid !== applicantUid) {
      throw new ForbiddenError('Only the applicant can withdraw the application');
    }

    if (application.status !== 'pending') {
      throw new BadRequestError('Can only withdraw pending applications');
    }

    application.status = 'withdrawn';
    application.updatedAt = new Date();
    await application.save();

    logger.info(`Application withdrawn: ${applicationId} by user ${applicantUid}`);
  }
}

