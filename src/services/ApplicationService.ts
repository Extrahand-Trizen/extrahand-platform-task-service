import TaskApplication, { ITaskApplication } from "../models/TaskApplication";
import Task from "../models/Task";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../errors/AppError";
import logger from "../config/logger";
import { ApplicationStatus } from "../types";
import mongoose from "mongoose";
import { NotificationClient } from "./NotificationClient";

export class ApplicationService {
  /**
   * Submit application for a task
   */
  static async submitApplication(
    taskId: string,
    applicantUid: string,
    applicationData: {
      proposedBudget: {
        amount: number;
        currency?: string;
        isNegotiable?: boolean;
      };
      proposedTime?: any;
      coverLetter?: string;
      relevantExperience?: string[];
      portfolio?: string[];
    }
  ): Promise<ITaskApplication> {
    // Check if task exists and is open
    const task = await Task.findById(taskId);
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (task.status !== "open") {
      throw new BadRequestError("Task is not open for applications");
    }

    if (task.requesterId === applicantUid) {
      throw new BadRequestError("Cannot apply to your own task");
    }

    // Check if user has already applied
    const existingApplication = await TaskApplication.findOne({
      taskId,
      applicantUid,
    });

    if (existingApplication) {
      throw new BadRequestError("You have already applied to this task");
    }

    // Create application
    const application = await TaskApplication.create({
      taskId,
      applicantUid,
      proposedBudget: {
        amount: Number(
          applicationData.proposedBudget?.amount ||
            applicationData.proposedBudget
        ),
        currency: applicationData.proposedBudget?.currency || "INR",
        isNegotiable: applicationData.proposedBudget?.isNegotiable !== false,
      },
      proposedTime: applicationData.proposedTime || { flexible: true },
      coverLetter: applicationData.coverLetter || "",
      relevantExperience: Array.isArray(applicationData.relevantExperience)
        ? applicationData.relevantExperience
        : [],
      portfolio: Array.isArray(applicationData.portfolio)
        ? applicationData.portfolio
        : [],
    });

    // Increment task applications count (atomic operation)
    await Task.updateOne({ _id: taskId }, { $inc: { applications: 1 } });

    logger.info(
      `Application submitted: ${application._id} for task ${taskId} by user ${applicantUid}`
    );

    // EMIT: APPLICATION_SUBMITTED notification to task requester
    try {
      await NotificationClient.send(
        {
          eventKey: 'APPLICATION_SUBMITTED',
          category: 'taskUpdates',
          actorId: applicantUid,
          recipients: [task.requesterId],
          entity: { type: 'application', id: application._id.toString() },
          title: `New application for: ${task.title}`,
          body: `Someone has applied to your task. Review their application to accept or reject.`,
          data: {
            taskId,
            applicationId: application._id.toString(),
            applicantUid
          }
        }
      );
    } catch (error) {
      logger.error('Error sending APPLICATION_SUBMITTED notification', {
        taskId,
        applicationId: application._id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

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
        throw new NotFoundError("Task not found");
      }

      // Only task owner can view applications for their task
      if (task.requesterId !== currentUserUid) {
        throw new ForbiddenError(
          "Not authorized to view applications for this task"
        );
      }

      query.taskId = taskId;
    }

    // Get my applications
    if (mine) {
      query.applicantUid = currentUserUid;
    }

    // Status filter
    if (
      status &&
      ["pending", "accepted", "rejected", "withdrawn"].includes(status)
    ) {
      query.status = status;
    }

    // Execute query - populate taskId
    const applications = await TaskApplication.find(query)
      .populate(
        "taskId",
        "title category budget location status requesterId requesterName"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();

    // Manually fetch applicant profiles using UID
    const Profile = mongoose.connection.collection("profiles");
    const enrichedApplications = await Promise.all(
      applications.map(async (app) => {
        try {
          const applicantProfile = await Profile.findOne({
            uid: app.applicantUid,
          });
          return {
            ...app,
            applicantProfile: applicantProfile
              ? {
                  name: applicantProfile.name,
                  photoURL: applicantProfile.photoURL,
                  rating: applicantProfile.rating,
                  totalReviews: applicantProfile.totalReviews,
                  skills: applicantProfile.skills,
                }
              : null,
          };
        } catch (error) {
          logger.warn(
            "Could not fetch applicant profile for",
            app.applicantUid
          );
          return app;
        }
      })
    );

    // Get total count for pagination
    const total = await TaskApplication.countDocuments(query);

    const results = enrichedApplications.map((app) => ({
      id: String(app._id),
      ...app,
    }));

    return {
      applications: results,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get a single application by ID with authorization
   */
  static async getApplicationById(
    applicationId: string,
    currentUserUid: string
  ): Promise<any> {
    const application = await TaskApplication.findById(applicationId)
      .populate(
        "taskId",
        "title category budget location status requesterId requesterName"
      )
      .lean();

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Authorization: User must be applicant or task creator
    const task = application.taskId as any;
    if (
      application.applicantUid !== currentUserUid &&
      task.requesterId !== currentUserUid
    ) {
      throw new ForbiddenError("Not authorized to view this application");
    }

    // Manually fetch applicant profile
    const Profile = mongoose.connection.collection("profiles");
    const applicantProfile = await Profile.findOne({
      uid: application.applicantUid,
    });

    return {
      ...application,
      id: String(application._id),
      applicantProfile: applicantProfile
        ? {
            name: applicantProfile.name,
            photoURL: applicantProfile.photoURL,
            rating: applicantProfile.rating,
            totalReviews: applicantProfile.totalReviews,
            skills: applicantProfile.skills,
          }
        : null,
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

    const application = await TaskApplication.findById(applicationId).populate(
      "taskId",
      "requesterId status title"
    );

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Only task creator can update application status
    const task = application.taskId as any;
    if (task.requesterId !== taskOwnerUid) {
      throw new ForbiddenError("Not authorized to update this application");
    }

    // STEP 1: Get old status for change detection
    const oldStatus = application.status;

    // Validate status transition
    if (status === "accepted") {
      if (task.status !== "open") {
        throw new BadRequestError("Task is not open for assignment");
      }

      // Reject all other pending applications for this task
      await TaskApplication.updateMany(
        {
          taskId: task._id,
          _id: { $ne: applicationId },
          status: "pending",
        },
        { status: "rejected" }
      );

      // Update task status to assigned
      await Task.updateOne(
        { _id: task._id },
        {
          status: "assigned",
          assigneeUid: application.applicantUid,
          updatedAt: new Date(),
        }
      );
    }

    // STEP 2: Update application status
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
        isRead: false,
      });
    }

    await application.save();

    // STEP 3: Emit notifications based on status change
    const statusChanged = oldStatus !== application.status;
    
    if (statusChanged) {
      if (application.status === 'accepted') {
        // Emit APPLICATION_ACCEPTED to applicant
        try {
          await NotificationClient.send(
            {
              eventKey: 'APPLICATION_ACCEPTED',
              category: 'taskUpdates',
              actorId: taskOwnerUid,
              recipients: [application.applicantUid],
              entity: { type: 'application', id: applicationId },
              title: `Your application was accepted!`,
              body: `Great news! Your application for "${task.title}" has been accepted.`,
              data: {
                taskId: task._id.toString(),
                applicationId,
                status: 'accepted'
              }
            }
          );
        } catch (error) {
          logger.error('Error sending APPLICATION_ACCEPTED notification', {
            applicationId,
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } else if (application.status === 'rejected') {
        // Emit APPLICATION_REJECTED to applicant
        try {
          await NotificationClient.send(
            {
              eventKey: 'APPLICATION_REJECTED',
              category: 'taskUpdates',
              actorId: taskOwnerUid,
              recipients: [application.applicantUid],
              entity: { type: 'application', id: applicationId },
              title: `Application Update: "${task.title}"`,
              body: `Unfortunately, your application for this task was not selected. Keep applying!`,
              data: {
                taskId: task._id.toString(),
                applicationId,
                status: 'rejected'
              }
            }
          );
        } catch (error) {
          logger.error('Error sending APPLICATION_REJECTED notification', {
            applicationId,
            taskId: task._id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    return application;
  }

  /**
   * Accept an application
   */
  static async acceptApplication(
    applicationId: string,
    taskOwnerUid: string
  ): Promise<ITaskApplication> {
    return this.updateApplication(applicationId, taskOwnerUid, {
      status: "accepted",
    });
  }

  /**
   * Reject an application
   */
  static async rejectApplication(
    applicationId: string,
    taskOwnerUid: string
  ): Promise<ITaskApplication> {
    return this.updateApplication(applicationId, taskOwnerUid, {
      status: "rejected",
    });
  }

  /**
   * Withdraw an application
   */
  static async withdrawPendingApplication(
    applicationId: string,
    applicantUid: string
  ): Promise<void> {
    const application = await TaskApplication.findById(applicationId);
    if (!application) {
      throw new NotFoundError("Application not found");
    }

    if (application.applicantUid !== applicantUid) {
      throw new ForbiddenError(
        "Only the applicant can withdraw the application"
      );
    }

    if (application.status !== "pending") {
      throw new BadRequestError("Can only withdraw pending applications");
    }

    application.status = "withdrawn";
    application.updatedAt = new Date();
    await application.save();

    logger.info(
      `Application withdrawn: ${applicationId} by user ${applicantUid}`
    );
  }

  static async withdrawAcceptedApplication(
    applicationId: string,
    applicantUid: string,
    reason?: string
  ): Promise<void> {
    const application = await TaskApplication.findById(applicationId);
    if (!application) {
      throw new NotFoundError("Application not found");
    }

    if (application.applicantUid !== applicantUid) {
      throw new ForbiddenError("Only the applicant can withdraw");
    }

    if (application.status !== "accepted") {
      throw new BadRequestError("Only accepted applications can be withdrawn");
    }

    // 1️⃣ Mark application withdrawn
    application.status = "withdrawn";
    application.updatedAt = new Date();
    await application.save();

    // 2️⃣ Reset task to OPEN
    await Task.updateOne(
      { _id: application.taskId },
      {
        status: "open",
        assigneeUid: null,
        assignedTo: null,
        assignedAt: null,
        updatedAt: new Date(),
      }
    );

    logger.warn(`Accepted application withdrawn: ${applicationId}`);

    // 3️⃣ (Optional but recommended)
    // Cancel escrow, notify poster, etc.
    // These should be NON-BLOCKING
  }
}
